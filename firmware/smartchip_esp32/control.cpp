#include "control.h"
#include <Adafruit_SHT31.h>
#include <Wire.h>
#include <esp_system.h>  // esp_random()
#include "config.h"
#include "display.h"

// ---------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------

static Adafruit_SHT31 sht1;
static Adafruit_SHT31 sht2;

static bool ssrOn = false;

static void setSSR(bool on) {
  ssrOn = on;
  digitalWrite(SSR_PIN, on ? HIGH : LOW);
}

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

static MachineState state = MachineState::IDLE;
static FaultCode fault = FaultCode::NONE;

struct Run {
  bool active = false;
  RunSource source = RunSource::NONE;
  char id[ID_LEN] = "";
  char batchId[ID_LEN] = "";
  float targetTemp = DEFAULT_TARGET_TEMP;
  uint16_t minutes = DEFAULT_DRYING_MINUTES;
  uint32_t preheatStartMs = 0;
  uint32_t dryingStartMs = 0;
};
static Run run;

// Menu values (kept between runs, like the original firmware)
static float menuTemp = DEFAULT_TARGET_TEMP;
static uint16_t menuMinutes = DEFAULT_DRYING_MINUTES;
static uint32_t lastMenuActivityMs = 0;

static bool manualSsr = false;
static uint32_t manualSsrSinceMs = 0;

// Sensors
struct SensorState {
  SensorReading reading;
  uint8_t failStreak = SENSOR_FAIL_LIMIT;  // "failed" until the first good read
};
static SensorState sensor1, sensor2;
static float avgTemp = NAN, avgHumidity = NAN;
static uint32_t lastSensorReadMs = 0;

static uint32_t lastLcdMs = 0;

// ---------------------------------------------------------------------
// Events to the cloud task (buffered there if Wi-Fi is down)
// ---------------------------------------------------------------------

static void emitFor(const Run& r, EventType type, EndReason reason = EndReason::NONE,
                    FaultCode code = FaultCode::NONE) {
  DeviceEvent e = {};
  e.type = type;
  e.source = r.source;
  copyId(e.runId, r.id);
  copyId(e.batchId, r.batchId);
  e.targetTemp = r.targetTemp;
  e.durationMinutes = r.minutes;
  e.reason = reason;
  e.fault = code;
  e.epoch = epochNow();
  if (xQueueSend(eventQueue, &e, 0) != pdTRUE) {
    Serial.println("[control] event queue full, event dropped");
  }
}

static void emit(EventType type, EndReason reason = EndReason::NONE, FaultCode code = FaultCode::NONE) {
  emitFor(run, type, reason, code);
}

// ---------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------

static bool sensorsOk() { return sensor1.reading.ok && sensor2.reading.ok; }

static void endRun(EndReason reason, FaultCode code = FaultCode::NONE) {
  setSSR(false);
  if (run.active) {
    emit(EventType::RUN_ENDED, reason, code);
    Serial.printf("[control] run %s ended: %s\n", run.id, endReasonName(reason));
  }
  run.active = false;
  run.id[0] = '\0';
  run.batchId[0] = '\0';
  run.source = RunSource::NONE;
}

static void enterFault(FaultCode code) {
  if (state == MachineState::FAULT && fault == code) return;
  manualSsr = false;
  endRun(EndReason::FAULT, code);
  fault = code;
  state = MachineState::FAULT;
  Serial.printf("[control] FAULT %s\n", faultCodeName(code));
}

static void beginRun(RunSource source, const char* id, const char* batchId, float temp, uint16_t minutes) {
  manualSsr = false;
  setSSR(false);
  run.active = true;
  run.source = source;
  copyId(run.id, id);
  copyId(run.batchId, batchId);
  run.targetTemp = temp;
  run.minutes = minutes;
  run.preheatStartMs = millis();
  run.dryingStartMs = 0;
  fault = FaultCode::NONE;
  state = MachineState::PREHEATING;
  Serial.printf("[control] run %s: preheat to %.1f C, then %u min\n", run.id, temp, minutes);
}

static void startLocalRun() {
  if (!sensorsOk()) {
    enterFault(!sensor1.reading.ok && !sensor2.reading.ok ? FaultCode::SENSOR_BOTH
               : !sensor1.reading.ok                     ? FaultCode::SENSOR_1
                                                         : FaultCode::SENSOR_2);
    return;
  }
  char id[ID_LEN];
  snprintf(id, sizeof(id), "local-%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  beginRun(RunSource::LOCAL, id, "", menuTemp, menuMinutes);
  emit(EventType::RUN_STARTED);
}

// STOP button / web STOP: heater off, back to IDLE (also clears a fault,
// like the original firmware; a still-present problem re-faults right away).
static void stopSystem(EndReason reason) {
  manualSsr = false;
  endRun(reason);
  fault = FaultCode::NONE;
  state = MachineState::IDLE;
  Serial.println("[control] stopped, heater OFF");
}

// ---------------------------------------------------------------------
// Sensors + safety
// ---------------------------------------------------------------------

static void readOne(Adafruit_SHT31& sht, SensorState& s) {
  float t = NAN, h = NAN;
  bool good = sht.readBoth(&t, &h) && !isnan(t) && !isnan(h) && t > -40 && t < 125 && h >= 0 && h <= 100;
  if (good) {
    s.failStreak = 0;
    s.reading.temperature = t;
    s.reading.humidity = h;
  } else if (s.failStreak < 255) {
    s.failStreak++;
  }
  s.reading.ok = s.failStreak < SENSOR_FAIL_LIMIT;
}

static void readSensors() {
  readOne(sht1, sensor1);
  readOne(sht2, sensor2);

  const SensorReading& a = sensor1.reading;
  const SensorReading& b = sensor2.reading;
  if (a.ok && b.ok) {
    avgTemp = (a.temperature + b.temperature) / 2.0f;
    avgHumidity = (a.humidity + b.humidity) / 2.0f;
  } else if (a.ok) {
    avgTemp = a.temperature;
    avgHumidity = a.humidity;
  } else if (b.ok) {
    avgTemp = b.temperature;
    avgHumidity = b.humidity;
  } else {
    avgTemp = avgHumidity = NAN;
  }

  Serial.printf("[sensors] S1 %s %.1fC %.0f%% | S2 %s %.1fC %.0f%% | SSR %s | %s\n", a.ok ? "ok " : "ERR",
                a.temperature, a.humidity, b.ok ? "ok " : "ERR", b.temperature, b.humidity, ssrOn ? "ON" : "OFF",
                machineStateName(state));
}

// Runs after every sensor read, in EVERY state.
static void safetyCheck() {
  float hottest = -1000;
  if (sensor1.reading.ok) hottest = max(hottest, sensor1.reading.temperature);
  if (sensor2.reading.ok) hottest = max(hottest, sensor2.reading.temperature);
  if (hottest >= SAFETY_MAX_TEMP) {
    setSSR(false);
    enterFault(FaultCode::OVER_TEMP);
    return;
  }

  bool running = state == MachineState::PREHEATING || state == MachineState::DRYING;
  if (running && !sensorsOk()) {
    FaultCode code = !sensor1.reading.ok && !sensor2.reading.ok ? FaultCode::SENSOR_BOTH
                     : !sensor1.reading.ok                     ? FaultCode::SENSOR_1
                                                               : FaultCode::SENSOR_2;
    enterFault(code);
    return;
  }

  // Manual SSR test: only with a working sensor, and never for long.
  if (manualSsr && (!sensor1.reading.ok && !sensor2.reading.ok)) {
    manualSsr = false;
    setSSR(false);
    Serial.println("[control] manual SSR off: no working sensor");
  }
}

// Thermostat with hysteresis: ON below target-1, OFF at target.
static void controlHeater() {
  if (isnan(avgTemp)) {
    setSSR(false);
    return;
  }
  if (avgTemp <= run.targetTemp - HYSTERESIS) setSSR(true);
  else if (avgTemp >= run.targetTemp) setSSR(false);
}

// ---------------------------------------------------------------------
// Buttons (edge-triggered; UP/DOWN repeat while held)
// ---------------------------------------------------------------------

struct Button {
  uint8_t pin;
  bool stable = false;      // pressed (debounced)
  bool lastRaw = false;
  uint32_t changedMs = 0;
  uint32_t pressedMs = 0;
  uint32_t lastRepeatMs = 0;
};

static Button btnStart{START_BUTTON}, btnStop{STOP_BUTTON}, btnUp{UP_BUTTON}, btnDown{DOWN_BUTTON}, btnSsr{SSR_BUTTON};

// Returns true once per press (and repeatedly while held if `repeat`).
static bool pressed(Button& b, bool repeat = false, bool* fast = nullptr) {
  uint32_t now = millis();
  bool raw = digitalRead(b.pin) == LOW;
  if (raw != b.lastRaw) {
    b.lastRaw = raw;
    b.changedMs = now;
  }
  if (now - b.changedMs < DEBOUNCE_MS) return false;

  if (raw && !b.stable) {
    b.stable = true;
    b.pressedMs = now;
    b.lastRepeatMs = now;
    if (fast) *fast = false;
    return true;
  }
  if (!raw) {
    b.stable = false;
    return false;
  }
  if (repeat && now - b.pressedMs >= REPEAT_DELAY_MS && now - b.lastRepeatMs >= REPEAT_RATE_MS) {
    b.lastRepeatMs = now;
    if (fast) *fast = now - b.pressedMs >= FAST_REPEAT_AFTER_MS;
    return true;
  }
  return false;
}

static void adjustMenu(int direction, bool fast) {
  lastMenuActivityMs = millis();
  if (state == MachineState::SET_TEMP) {
    menuTemp = constrain(menuTemp + direction * 1.0f, MIN_TARGET_TEMP, MAX_TARGET_TEMP);
  } else if (state == MachineState::SET_TIME) {
    int step = fast ? 10 : 1;
    int value = (int)menuMinutes + direction * step;
    menuMinutes = (uint16_t)constrain(value, MIN_DRYING_MINUTES, MAX_DRYING_MINUTES);
  }
}

static void handleButtons() {
  // STOP always wins.
  if (pressed(btnStop)) {
    if (state == MachineState::SET_TEMP || state == MachineState::SET_TIME) {
      state = MachineState::IDLE;  // just leave the menu
    } else {
      stopSystem(EndReason::STOPPED_BUTTON);
    }
    return;
  }

  if (pressed(btnStart)) {
    lastMenuActivityMs = millis();
    switch (state) {
      case MachineState::IDLE:
      case MachineState::COMPLETE:
        manualSsr = false;
        setSSR(false);
        state = MachineState::SET_TEMP;
        break;
      case MachineState::SET_TEMP:
        state = MachineState::SET_TIME;
        break;
      case MachineState::SET_TIME:
        startLocalRun();
        break;
      default:
        break;  // ignored while running or in fault
    }
    return;
  }

  bool fast = false;
  if (pressed(btnUp, true, &fast)) adjustMenu(+1, fast);
  if (pressed(btnDown, true, &fast)) adjustMenu(-1, fast);

  if (pressed(btnSsr) && state == MachineState::IDLE) {
    if (!manualSsr && !sensor1.reading.ok && !sensor2.reading.ok) {
      Serial.println("[control] manual SSR refused: no working sensor");
    } else {
      manualSsr = !manualSsr;
      manualSsrSinceMs = millis();
      setSSR(manualSsr);
      Serial.printf("[control] manual SSR %s\n", manualSsr ? "ON" : "OFF");
    }
  }
}

// ---------------------------------------------------------------------
// Commands from the web (via the cloud task)
// ---------------------------------------------------------------------

static void handleCommands() {
  ControlCommand cmd;
  while (xQueueReceive(commandQueue, &cmd, 0) == pdTRUE) {
    switch (cmd.type) {
      case CommandType::START: {
        bool free = state == MachineState::IDLE || state == MachineState::COMPLETE;
        if (!free || !sensorsOk()) {
          // The cloud task already checked, so this is a rare race (e.g. someone
          // opened the menu in the last second). Tell Firestore it didn't start.
          Run failed;
          failed.source = RunSource::WEB;
          copyId(failed.id, cmd.runId);
          copyId(failed.batchId, cmd.batchId);
          failed.targetTemp = cmd.targetTemp;
          failed.minutes = cmd.durationMinutes;
          emitFor(failed, EventType::START_FAILED, EndReason::REJECTED);
          break;
        }
        beginRun(RunSource::WEB, cmd.runId, cmd.batchId, cmd.targetTemp, cmd.durationMinutes);
        break;
      }
      case CommandType::STOP:
        if (run.active && strcmp(run.id, cmd.runId) == 0) stopSystem(EndReason::STOPPED_WEB);
        break;
      case CommandType::CLEAR_FAULT:
        if (state == MachineState::FAULT) {
          fault = FaultCode::NONE;
          state = MachineState::IDLE;
          Serial.println("[control] fault cleared from the app");
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

void controlBegin() {
  pinMode(SSR_PIN, OUTPUT);
  setSSR(false);  // safe state first, before anything else

  for (uint8_t pin : {START_BUTTON, STOP_BUTTON, UP_BUTTON, DOWN_BUTTON, SSR_BUTTON}) pinMode(pin, INPUT_PULLUP);

  Wire.begin(SDA_PIN, SCL_PIN);
  displayBegin();
  displayShowMessage("SMARTCHIP v" FIRMWARE_VERSION, "Starting...");

  bool found1 = sht1.begin(SHT31_1_ADDR);
  bool found2 = sht2.begin(SHT31_2_ADDR);
  Serial.printf("[control] SHT31 #1 %s, SHT31 #2 %s\n", found1 ? "found" : "NOT FOUND", found2 ? "found" : "NOT FOUND");

  readSensors();
  lastSensorReadMs = millis();
}

void controlLoop() {
  uint32_t now = millis();

  if (now - lastSensorReadMs >= SENSOR_INTERVAL_MS) {
    lastSensorReadMs = now;
    readSensors();
    safetyCheck();
  }

  handleButtons();
  handleCommands();

  switch (state) {
    case MachineState::IDLE:
      if (manualSsr && now - manualSsrSinceMs >= MANUAL_SSR_MAX_MS) {
        manualSsr = false;
        setSSR(false);
        Serial.println("[control] manual SSR test timed out");
      }
      if (!manualSsr && ssrOn) setSSR(false);
      break;

    case MachineState::SET_TEMP:
    case MachineState::SET_TIME:
      setSSR(false);
      if (now - lastMenuActivityMs >= MENU_TIMEOUT_MS) state = MachineState::IDLE;
      break;

    case MachineState::PREHEATING:
      controlHeater();
      if (!isnan(avgTemp) && avgTemp >= run.targetTemp) {
        state = MachineState::DRYING;
        run.dryingStartMs = now;
        emit(EventType::DRYING_STARTED);
        Serial.printf("[control] target reached, drying for %u min\n", run.minutes);
      } else if (PREHEAT_TIMEOUT_MINUTES > 0 && now - run.preheatStartMs >= PREHEAT_TIMEOUT_MINUTES * 60000UL) {
        enterFault(FaultCode::PREHEAT_TIMEOUT);
      }
      break;

    case MachineState::DRYING: {
      controlHeater();
      uint32_t elapsed = now - run.dryingStartMs;
      if (elapsed >= (uint32_t)run.minutes * 60000UL) {
        endRun(EndReason::COMPLETED);
        state = MachineState::COMPLETE;
        Serial.println("[control] DRYING COMPLETE");
      }
      break;
    }

    case MachineState::COMPLETE:
    case MachineState::FAULT:
      setSSR(false);
      break;
  }

  // Publish for the cloud task + LCD.
  Snapshot s;
  s.state = state;
  s.source = run.active ? run.source : RunSource::NONE;
  copyId(s.runId, run.active ? run.id : "");
  copyId(s.batchId, run.active ? run.batchId : "");
  s.targetTemp = run.active ? run.targetTemp : NAN;
  s.durationMinutes = run.active ? run.minutes : 0;
  if (state == MachineState::DRYING) {
    uint32_t elapsed = now - run.dryingStartMs;
    uint32_t total = (uint32_t)run.minutes * 60000UL;
    s.remainingSeconds = elapsed >= total ? 0 : (total - elapsed + 999) / 1000;
  }
  s.s1 = sensor1.reading;
  s.s2 = sensor2.reading;
  s.avgTemp = avgTemp;
  s.avgHumidity = avgHumidity;
  s.heater = ssrOn;
  s.fault = state == MachineState::FAULT ? fault : FaultCode::NONE;
  publishSnapshot(s);

  if (now - lastLcdMs >= LCD_INTERVAL_MS) {
    lastLcdMs = now;
    DisplayModel m;
    m.snap = s;
    m.menuTemp = menuTemp;
    m.menuMinutes = menuMinutes;
    m.preheatSeconds = state == MachineState::PREHEATING ? (now - run.preheatStartMs) / 1000 : 0;
    m.manualSsr = manualSsr;
    m.cloud = getCloudStatus();
    displayUpdate(m);
  }
}

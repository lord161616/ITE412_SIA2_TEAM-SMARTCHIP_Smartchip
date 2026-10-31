#include "cloud.h"
#include <WiFi.h>
#include "config.h"
#include "firestore.h"
#include "secrets_include.h"
#include "shared.h"

using fs::Precondition;

static const char* DEVICE_PATH = "devices/" DEVICE_ID;

// The last command we handled. Written as lastCommandId / lastCommandResult
// with every device-state write, so any successful write acknowledges it.
static String ackId;
static String ackResult;
static bool ackKnown = false;  // loaded from Firestore after boot?

static bool reconciled = false;  // post-boot cleanup done?
static bool bootedAtWritten = false;
static bool heartbeatNow = true;

static DeviceEvent pending[EVENT_BUFFER_SIZE];
static int pendingCount = 0;

// ---------------------------------------------------------------------
// Building writes
// ---------------------------------------------------------------------

// Fields a commit may set differently from the live snapshot (used when a
// START is accepted, before the control loop has actually started it).
struct StateOverride {
  const char* status = nullptr;
  const char* runId = nullptr;
  const char* batchId = nullptr;
  const char* source = nullptr;
  float targetTemp = NAN;
  int durationMinutes = 0;
  const char* ackId = nullptr;
  const char* ackResult = nullptr;
};

static void addSensor(JsonObject sensors, const char* key, const SensorReading& r) {
  JsonObject f = sensors[key]["mapValue"]["fields"].to<JsonObject>();
  fs::setNumber(f, "temperature", r.ok ? r.temperature : NAN);
  fs::setNumber(f, "humidity", r.ok ? r.humidity : NAN);
  fs::setBool(f, "ok", r.ok);
}

static void addDeviceState(JsonArray writes, const Snapshot& s, const StateOverride* o = nullptr) {
  fs::Write w(writes, DEVICE_PATH);
  bool overriding = o && o->status;
  bool drying = s.state == MachineState::DRYING;

  w.str("deviceId", DEVICE_ID);
  w.str("firmware", FIRMWARE_VERSION);
  w.str("status", overriding ? o->status : machineStateName(s.state));
  w.str("runId", overriding ? o->runId : s.runId);
  w.str("batchId", overriding ? o->batchId : s.batchId);
  w.str("source", overriding ? o->source : runSourceName(s.source));
  w.num("targetTemp", overriding ? o->targetTemp : s.targetTemp);
  int minutes = overriding ? o->durationMinutes : s.durationMinutes;
  if (minutes > 0) w.integer("durationMinutes", minutes);
  else w.null("durationMinutes");
  if (drying && !overriding) w.integer("remainingSeconds", (long)s.remainingSeconds);
  else w.null("remainingSeconds");
  w.num("temperature", s.avgTemp);
  w.num("humidity", s.avgHumidity);
  JsonObject sensors = w.map("sensors");
  addSensor(sensors, "s1", s.s1);
  addSensor(sensors, "s2", s.s2);
  w.boolean("heater", s.heater);
  w.str("faultCode", faultCodeName(s.fault));
  w.integer("wifiRssi", WiFi.RSSI());

  const char* id = o && o->ackId ? o->ackId : (ackKnown ? ackId.c_str() : nullptr);
  const char* result = o && o->ackResult ? o->ackResult : ackResult.c_str();
  if (id) {
    w.str("lastCommandId", id);
    w.str("lastCommandResult", result);
  }

  w.serverTime("lastSeen");
  if (!bootedAtWritten) w.serverTime("bootedAt");
}

static void addRunEnd(JsonArray writes, const char* runId, const char* status, EndReason reason, FaultCode fault,
                      time_t epoch) {
  fs::Write w(writes, (String("dryingRuns/") + runId).c_str(), Precondition::MUST_EXIST);
  w.str("status", status);
  w.timestamp("endedAt", epoch);
  w.str("endReason", endReasonName(reason));
  w.str("faultCode", faultCodeName(fault));
  w.serverTime("updatedAt");
}

static void addBatchStatus(JsonArray writes, const char* batchId, const char* status) {
  if (!batchId || !batchId[0]) return;
  fs::Write w(writes, (String("inventory/") + batchId).c_str(), Precondition::MUST_EXIST);
  w.str("status", status);
  w.serverTime("updatedAt");
}

static const char* endStatus(EndReason r) {
  switch (r) {
    case EndReason::COMPLETED: return "completed";
    case EndReason::STOPPED_WEB:
    case EndReason::STOPPED_BUTTON: return "stopped";
    default: return "failed";
  }
}

// A 4xx answer (other than auth / rate limit) won't succeed on retry.
static bool isPermanentFailure(int code) { return code >= 400 && code < 500 && code != 401 && code != 408 && code != 429; }

static void noteResult(int code) {
  if (code == 200 || code == 404) setCloudStatus(CloudStatus::ONLINE);
  else if (code == 403) setCloudStatus(CloudStatus::AUTH_ERROR);  // LCD shows "!"
  else if (code < 0) setCloudStatus(CloudStatus::CONNECTING);
}

// ---------------------------------------------------------------------
// Events from the control loop
// ---------------------------------------------------------------------

static int commitEvent(const DeviceEvent& e, bool includeBatch) {
  JsonDocument body;
  JsonArray writes = body["writes"].to<JsonArray>();
  String runPath = String("dryingRuns/") + e.runId;

  switch (e.type) {
    case EventType::RUN_STARTED: {  // local run: create its document
      fs::Write w(writes, runPath.c_str(), Precondition::MUST_NOT_EXIST);
      w.str("deviceId", DEVICE_ID);
      w.str("source", "local");
      w.null("batchId");
      w.null("batchNumber");
      w.null("initialWeight");
      w.num("targetTemp", e.targetTemp);
      w.integer("durationMinutes", e.durationMinutes);
      w.str("status", "preheating");
      w.str("requestedBy", "device");
      w.timestamp("startedAt", e.epoch);
      w.null("dryingStartedAt");
      w.null("endedAt");
      w.null("endReason");
      w.null("faultCode");
      w.null("finalWeight");
      w.timestamp("createdAt", e.epoch);
      w.serverTime("updatedAt");
      break;
    }
    case EventType::DRYING_STARTED: {
      fs::Write w(writes, runPath.c_str(), Precondition::MUST_EXIST);
      w.str("status", "drying");
      w.timestamp("dryingStartedAt", e.epoch);
      w.serverTime("updatedAt");
      break;
    }
    case EventType::RUN_ENDED:
      addRunEnd(writes, e.runId, endStatus(e.reason), e.reason, e.fault, e.epoch);
      if (includeBatch) addBatchStatus(writes, e.batchId, e.reason == EndReason::COMPLETED ? "Dried" : "Fresh");
      break;
    case EventType::START_FAILED:
      addRunEnd(writes, e.runId, "failed", EndReason::REJECTED, FaultCode::NONE, e.epoch);
      if (includeBatch) addBatchStatus(writes, e.batchId, "Fresh");
      break;
  }

  addDeviceState(writes, readSnapshot());
  return fs::commit(body);
}

static void processEvents() {
  DeviceEvent e;
  while (xQueueReceive(eventQueue, &e, 0) == pdTRUE) {
    if (pendingCount == EVENT_BUFFER_SIZE) {
      Serial.println("[cloud] event buffer full, dropping oldest");
      memmove(&pending[0], &pending[1], sizeof(DeviceEvent) * (EVENT_BUFFER_SIZE - 1));
      pendingCount--;
    }
    pending[pendingCount++] = e;
  }

  while (pendingCount > 0) {
    int code = commitEvent(pending[0], true);
    // Rejected? Usually the batch was already changed in the app (e.g. after
    // a recovery). Try once more without touching the batch.
    if (isPermanentFailure(code)) code = commitEvent(pending[0], false);
    noteResult(code);
    if (code == 200 || isPermanentFailure(code)) {
      if (code != 200) Serial.printf("[cloud] dropping event for run %s (HTTP %d)\n", pending[0].runId, code);
      else bootedAtWritten = true;
      memmove(&pending[0], &pending[1], sizeof(DeviceEvent) * (pendingCount - 1));
      pendingCount--;
      continue;
    }
    break;  // network problem: keep it and retry later
  }
}

// ---------------------------------------------------------------------
// Commands from the web app
// ---------------------------------------------------------------------

static void setAck(const char* id, const String& result) {
  ackId = id;
  ackResult = result;
  ackKnown = true;
  heartbeatNow = true;  // report it straight away
}

static bool sendToControl(CommandType type, const char* runId, const char* batchId, float temp, uint16_t minutes) {
  ControlCommand c = {};
  c.type = type;
  copyId(c.runId, runId);
  copyId(c.batchId, batchId);
  c.targetTemp = temp;
  c.durationMinutes = minutes;
  return xQueueSend(commandQueue, &c, pdMS_TO_TICKS(100)) == pdTRUE;
}

static bool sensorsOk(const Snapshot& s) { return s.s1.ok && s.s2.ok; }

static bool overSafety(const Snapshot& s) {
  return (s.s1.ok && s.s1.temperature >= SAFETY_MAX_TEMP) || (s.s2.ok && s.s2.temperature >= SAFETY_MAX_TEMP);
}

static void rejectStart(const char* cmdId, const char* runId, const char* batchId, const char* reason) {
  String result = String("rejected:") + reason;
  EndReason why = strcmp(reason, "EXPIRED") == 0 ? EndReason::EXPIRED : EndReason::REJECTED;
  Serial.printf("[cloud] START %s rejected: %s\n", runId ? runId : "?", reason);

  StateOverride ack;
  ack.ackId = cmdId;
  ack.ackResult = result.c_str();

  for (int attempt = 0; attempt < 2; attempt++) {
    JsonDocument body;
    JsonArray writes = body["writes"].to<JsonArray>();
    if (attempt == 0 && runId && runId[0]) {
      addRunEnd(writes, runId, "failed", why, FaultCode::NONE, epochNow());
      addBatchStatus(writes, batchId, "Fresh");
    }
    addDeviceState(writes, readSnapshot(), &ack);
    int code = fs::commit(body);
    noteResult(code);
    if (code == 200) {
      setAck(cmdId, result);
      return;
    }
    if (!isPermanentFailure(code)) return;  // network: retry on the next poll
    // Run/batch already changed (e.g. cancelled in the app): just acknowledge.
  }
  setAck(cmdId, result);
}

static void acceptStart(const char* cmdId, const char* runId, const char* batchId, float temp, int minutes) {
  JsonDocument body;
  JsonArray writes = body["writes"].to<JsonArray>();
  {
    fs::Write w(writes, (String("dryingRuns/") + runId).c_str(), Precondition::MUST_EXIST);
    w.str("status", "preheating");
    w.timestamp("startedAt", epochNow());
    w.serverTime("updatedAt");
  }
  StateOverride o;
  o.status = "preheating";
  o.runId = runId;
  o.batchId = batchId;
  o.source = "web";
  o.targetTemp = temp;
  o.durationMinutes = minutes;
  o.ackId = cmdId;
  o.ackResult = "accepted";
  addDeviceState(writes, readSnapshot(), &o);

  // Firestore first, heater second: if the app cancelled this START a moment
  // ago, the commit is refused and the heater never turns on.
  int code = fs::commit(body);
  noteResult(code);
  if (code == 200) {
    setAck(cmdId, "accepted");
    sendToControl(CommandType::START, runId, batchId, temp, (uint16_t)minutes);
    Serial.printf("[cloud] START %s accepted: %.1f C, %d min\n", runId, temp, minutes);
  } else if (isPermanentFailure(code)) {
    rejectStart(cmdId, nullptr, nullptr, "INVALID");
  }
}

static void handleCommand(JsonVariantConst cmd, const char* cmdId, bool atBoot) {
  const char* type = fs::readString(cmd, "type");
  Snapshot s = readSnapshot();
  if (!type) type = "";

  if (strcmp(type, "START") == 0) {
    const char* runId = fs::readString(cmd, "runId");
    const char* batchId = fs::readString(cmd, "batchId");
    float temp = (float)fs::readNumber(cmd, "targetTemp", NAN);
    int minutes = (int)fs::readNumber(cmd, "durationMinutes", 0);
    time_t requestedAt = fs::readTimestamp(cmd, "requestedAt");
    time_t now = epochNow();

    const char* reason = nullptr;
    if (!runId || !runId[0] || isnan(temp) || temp < MIN_TARGET_TEMP || temp > MAX_TARGET_TEMP ||
        minutes < MIN_DRYING_MINUTES || minutes > MAX_DRYING_MINUTES)
      reason = "INVALID";
    else if (atBoot || (now && requestedAt && now - requestedAt > COMMAND_MAX_AGE_S))
      reason = "EXPIRED";
    else if (s.state == MachineState::FAULT)
      reason = "FAULT_ACTIVE";
    else if (s.state == MachineState::SET_TEMP || s.state == MachineState::SET_TIME)
      reason = "LOCAL_MENU";
    else if (s.state == MachineState::PREHEATING || s.state == MachineState::DRYING)
      reason = "BUSY";
    else if (!sensorsOk(s))
      reason = "SENSORS_NOT_READY";

    if (reason) rejectStart(cmdId, runId, batchId, reason);
    else acceptStart(cmdId, runId, batchId, temp, minutes);
    return;
  }

  if (strcmp(type, "STOP") == 0) {
    const char* runId = fs::readString(cmd, "runId");
    bool running = s.state == MachineState::PREHEATING || s.state == MachineState::DRYING;
    if (atBoot) {
      setAck(cmdId, "rejected:EXPIRED");
    } else if (running && runId && strcmp(runId, s.runId) == 0) {
      sendToControl(CommandType::STOP, runId, "", NAN, 0);  // heater off first, report after
      setAck(cmdId, "accepted");
    } else {
      setAck(cmdId, "rejected:NOT_RUNNING");
    }
    return;
  }

  if (strcmp(type, "CLEAR_FAULT") == 0) {
    if (s.state != MachineState::FAULT) setAck(cmdId, "done");
    else if (overSafety(s)) setAck(cmdId, "rejected:STILL_OVER_TEMPERATURE");
    else {
      sendToControl(CommandType::CLEAR_FAULT, "", "", NAN, 0);
      setAck(cmdId, "accepted");
    }
    return;
  }

  setAck(cmdId, "rejected:INVALID");
}

// After a restart: the ESP32 can't resume a run (its timer is gone), so a
// run Firestore still thinks is active is failed as "power_loss".
static void reconcileAfterBoot(JsonVariantConst fields) {
  const char* staleRun = fs::readString(fields, "runId");
  const char* staleBatch = fs::readString(fields, "batchId");
  Snapshot s = readSnapshot();
  if (!staleRun || !staleRun[0] || strcmp(staleRun, s.runId) == 0) return;

  Serial.printf("[cloud] run %s was interrupted by a restart, marking it failed\n", staleRun);
  for (int attempt = 0; attempt < 3; attempt++) {
    JsonDocument body;
    JsonArray writes = body["writes"].to<JsonArray>();
    if (attempt < 2) addRunEnd(writes, staleRun, "failed", EndReason::POWER_LOSS, FaultCode::NONE, epochNow());
    if (attempt < 1) addBatchStatus(writes, staleBatch, "Fresh");
    addDeviceState(writes, s);
    int code = fs::commit(body);
    if (code == 200) {
      bootedAtWritten = true;
      return;
    }
    if (!isPermanentFailure(code)) return;
  }
}

static void pollDevice() {
  JsonDocument doc;
  int code = fs::getDocument(DEVICE_PATH, doc);
  noteResult(code);

  if (code == 404) {  // first boot ever: the heartbeat creates the document
    ackKnown = true;
    reconciled = true;
    heartbeatNow = true;
    return;
  }
  if (code != 200) {
    // Log every failure (at most every 30 s) so a rules / project ID problem
    // is visible in the Serial Monitor instead of failing silently.
    static uint32_t lastLog = 0;
    if (lastLog == 0 || millis() - lastLog > 30000) {
      lastLog = millis();
      if (code == 403)
        Serial.println("[cloud] read devices/" DEVICE_ID " DENIED (403): this ESP32's uid is not in isDevice() "
                       "in firestore.rules, or the rules were not deployed");
      else if (code < 0)
        Serial.printf("[cloud] read devices/" DEVICE_ID " failed: no connection to Firestore (%d)\n", code);
      else
        Serial.printf("[cloud] read devices/" DEVICE_ID " failed (HTTP %d): check FIREBASE_PROJECT_ID in secrets.h\n", code);
    }
    return;
  }

  JsonVariantConst fields = doc["fields"];
  bool atBoot = !reconciled;
  if (!ackKnown) {
    const char* id = fs::readString(fields, "lastCommandId");
    const char* result = fs::readString(fields, "lastCommandResult");
    ackId = id ? id : "";
    ackResult = result ? result : "";
    ackKnown = true;
  }
  if (!reconciled) {
    reconcileAfterBoot(fields);
    reconciled = true;
    heartbeatNow = true;
  }

  JsonVariantConst cmd = fs::readMap(fields, "command");
  if (cmd.isNull()) return;
  const char* cmdId = fs::readString(cmd, "id");
  if (!cmdId || ackId == cmdId) return;  // nothing new

  Serial.printf("[cloud] command %s (%s)%s\n", fs::readString(cmd, "type"), cmdId, atBoot ? " [waiting since before boot]" : "");
  handleCommand(cmd, cmdId, atBoot);
}

static void heartbeat() {
  JsonDocument body;
  JsonArray writes = body["writes"].to<JsonArray>();
  addDeviceState(writes, readSnapshot());
  int code = fs::commit(body);
  noteResult(code);
  if (code == 200) bootedAtWritten = true;
}

// ---------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------

// One pass of the sync loop. Returns how long to wait before the next pass.
static uint32_t lastWifiAttempt = 0, lastPoll = 0, lastBeat = 0, authRetryAt = 0;
static bool wifiStarted = false, clockStarted = false;
static MachineState lastState = MachineState::IDLE;

uint32_t cloudStep() {
  uint32_t now = millis();

  if (!wifiStarted) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttempt = now;
    wifiStarted = true;
  }

  if (WiFi.status() != WL_CONNECTED) {
    setCloudStatus(CloudStatus::NO_WIFI);
    if (now - lastWifiAttempt >= WIFI_RETRY_MS) {
      Serial.println("[cloud] Wi-Fi not connected, retrying");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      lastWifiAttempt = now;
    }
    return 500;
  }

  if (!clockStarted) {
    Serial.printf("[cloud] Wi-Fi connected, IP %s\n", WiFi.localIP().toString().c_str());
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    clockStarted = true;
  }

  if ((int32_t)(authRetryAt - now) > 0) return 500;
  if (!fs::ensureSignedIn()) {
    setCloudStatus(fs::hasAuthError() ? CloudStatus::AUTH_ERROR : CloudStatus::CONNECTING);
    authRetryAt = now + (fs::hasAuthError() ? AUTH_RETRY_MS : 5000);
    return 500;
  }

  // Read the device document first after boot, so we don't overwrite the
  // state reconcileAfterBoot() needs.
  if (!reconciled || now - lastPoll >= COMMAND_POLL_MS) {
    pollDevice();
    lastPoll = now;
  }
  if (!reconciled) return 1000;

  processEvents();

  Snapshot s = readSnapshot();
  if (s.state != lastState) {
    heartbeatNow = true;
    lastState = s.state;
  }
  if (heartbeatNow || now - lastBeat >= HEARTBEAT_MS) {
    heartbeatNow = false;
    heartbeat();
    lastBeat = millis();
  }
  return 100;
}

static void cloudTask(void*) {
  for (;;) vTaskDelay(pdMS_TO_TICKS(cloudStep()));
}

void cloudBegin() {
  if (strlen(WIFI_SSID) == 0) {
    Serial.println("[cloud] no Wi-Fi configured: running offline only");
    return;
  }
  setCloudStatus(CloudStatus::CONNECTING);
  xTaskCreatePinnedToCore(cloudTask, "cloud", 16384, nullptr, 1, nullptr, 0);
}

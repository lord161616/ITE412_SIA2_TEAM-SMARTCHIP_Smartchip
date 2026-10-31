// =====================================================================
// Data shared between the two halves of the firmware:
//
//   core 1  control  (sensors, heater, buttons, LCD)  – never waits on the network
//   core 0  cloud    (Wi-Fi, Firebase)                – may block for seconds
//
// They only talk through the snapshot (control -> cloud), the command
// queue (cloud -> control) and the event queue (control -> cloud).
// =====================================================================
#pragma once
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <time.h>

constexpr size_t ID_LEN = 48;

enum class MachineState : uint8_t { IDLE, SET_TEMP, SET_TIME, PREHEATING, DRYING, COMPLETE, FAULT };
enum class RunSource : uint8_t { NONE, WEB, LOCAL };
enum class FaultCode : uint8_t { NONE, SENSOR_1, SENSOR_2, SENSOR_BOTH, OVER_TEMP, PREHEAT_TIMEOUT };
enum class EndReason : uint8_t { NONE, COMPLETED, STOPPED_WEB, STOPPED_BUTTON, FAULT, POWER_LOSS, REJECTED, EXPIRED };
enum class CloudStatus : uint8_t { NO_WIFI, CONNECTING, ONLINE, AUTH_ERROR };

struct SensorReading {
  float temperature = NAN;
  float humidity = NAN;
  bool ok = false;
};

// Everything the cloud needs to report, copied from the control loop.
struct Snapshot {
  MachineState state = MachineState::IDLE;
  RunSource source = RunSource::NONE;
  char runId[ID_LEN] = "";
  char batchId[ID_LEN] = "";
  float targetTemp = NAN;
  uint16_t durationMinutes = 0;
  uint32_t remainingSeconds = 0;  // only meaningful while DRYING
  SensorReading s1, s2;
  float avgTemp = NAN;
  float avgHumidity = NAN;
  bool heater = false;
  FaultCode fault = FaultCode::NONE;
};

// Cloud -> control
enum class CommandType : uint8_t { START, STOP, CLEAR_FAULT };
struct ControlCommand {
  CommandType type;
  char runId[ID_LEN];
  char batchId[ID_LEN];
  float targetTemp;
  uint16_t durationMinutes;
};

// Control -> cloud: things that must reach Firestore even if Wi-Fi is down
// right now (they are buffered and retried in order).
enum class EventType : uint8_t {
  RUN_STARTED,     // local (button) run began: create the run document
  DRYING_STARTED,  // target reached: countdown started
  RUN_ENDED,       // completed / stopped / fault
  START_FAILED     // a web START was accepted but couldn't actually start
};
struct DeviceEvent {
  EventType type;
  RunSource source;
  char runId[ID_LEN];
  char batchId[ID_LEN];
  float targetTemp;
  uint16_t durationMinutes;
  EndReason reason;
  FaultCode fault;
  time_t epoch;  // 0 if the clock isn't synced yet (server time is used)
};

extern QueueHandle_t commandQueue;
extern QueueHandle_t eventQueue;

void sharedInit();
void publishSnapshot(const Snapshot& s);
Snapshot readSnapshot();

void setCloudStatus(CloudStatus s);
CloudStatus getCloudStatus();

// Current UNIX time, or 0 if NTP hasn't synced yet.
time_t epochNow();

// Firestore strings for the enums.
const char* machineStateName(MachineState s);
const char* faultCodeName(FaultCode f);
const char* endReasonName(EndReason r);
const char* runSourceName(RunSource s);

void copyId(char* dest, const char* src);

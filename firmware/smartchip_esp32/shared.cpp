#include "shared.h"
#include <string.h>

QueueHandle_t commandQueue = nullptr;
QueueHandle_t eventQueue = nullptr;

static Snapshot snapshot;
static portMUX_TYPE snapshotLock = portMUX_INITIALIZER_UNLOCKED;
static volatile uint8_t cloudStatus = (uint8_t)CloudStatus::NO_WIFI;

void sharedInit() {
  commandQueue = xQueueCreate(4, sizeof(ControlCommand));
  eventQueue = xQueueCreate(8, sizeof(DeviceEvent));
}

void publishSnapshot(const Snapshot& s) {
  portENTER_CRITICAL(&snapshotLock);
  snapshot = s;
  portEXIT_CRITICAL(&snapshotLock);
}

Snapshot readSnapshot() {
  portENTER_CRITICAL(&snapshotLock);
  Snapshot copy = snapshot;
  portEXIT_CRITICAL(&snapshotLock);
  return copy;
}

void setCloudStatus(CloudStatus s) { cloudStatus = (uint8_t)s; }
CloudStatus getCloudStatus() { return (CloudStatus)cloudStatus; }

time_t epochNow() {
  time_t now = time(nullptr);
  return now > 1700000000 ? now : 0;  // before 2023 = not synced
}

const char* machineStateName(MachineState s) {
  switch (s) {
    case MachineState::IDLE: return "idle";
    case MachineState::SET_TEMP:
    case MachineState::SET_TIME: return "setup";
    case MachineState::PREHEATING: return "preheating";
    case MachineState::DRYING: return "drying";
    case MachineState::COMPLETE: return "completed";
    case MachineState::FAULT: return "fault";
  }
  return "idle";
}

const char* faultCodeName(FaultCode f) {
  switch (f) {
    case FaultCode::NONE: return nullptr;
    case FaultCode::SENSOR_1: return "SENSOR_1_FAILURE";
    case FaultCode::SENSOR_2: return "SENSOR_2_FAILURE";
    case FaultCode::SENSOR_BOTH: return "SENSOR_FAILURE";
    case FaultCode::OVER_TEMP: return "OVER_TEMPERATURE";
    case FaultCode::PREHEAT_TIMEOUT: return "PREHEAT_TIMEOUT";
  }
  return "DEVICE_ERROR";
}

const char* endReasonName(EndReason r) {
  switch (r) {
    case EndReason::NONE: return nullptr;
    case EndReason::COMPLETED: return "completed";
    case EndReason::STOPPED_WEB: return "stopped_web";
    case EndReason::STOPPED_BUTTON: return "stopped_button";
    case EndReason::FAULT: return "fault";
    case EndReason::POWER_LOSS: return "power_loss";
    case EndReason::REJECTED: return "rejected";
    case EndReason::EXPIRED: return "expired";
  }
  return nullptr;
}

const char* runSourceName(RunSource s) {
  switch (s) {
    case RunSource::WEB: return "web";
    case RunSource::LOCAL: return "local";
    case RunSource::NONE: return nullptr;
  }
  return nullptr;
}

void copyId(char* dest, const char* src) {
  if (!src) {
    dest[0] = '\0';
    return;
  }
  strncpy(dest, src, ID_LEN - 1);
  dest[ID_LEN - 1] = '\0';
}

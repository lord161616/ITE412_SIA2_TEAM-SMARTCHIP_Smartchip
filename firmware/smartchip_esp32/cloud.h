// Wi-Fi + Firestore sync. Runs as its own FreeRTOS task on core 0, so a slow
// or dead network can never delay the heater control on core 1.
//
//   every 4 s   read devices/{id}.command and act on new commands
//   every 10 s  write state + readings (heartbeat)
//   on events   update the run and batch documents (buffered while offline)
//
// Field-by-field contract: docs/DATA_MODEL.md
#pragma once

#include <stdint.h>

void cloudBegin();

// One pass of the sync loop (the task calls this forever). Returns ms to wait.
uint32_t cloudStep();

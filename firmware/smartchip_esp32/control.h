// Heater control, sensors, buttons and the drying state machine.
// Runs on core 1 and never waits for the network: the dehydrator works
// exactly the same with Wi-Fi down.
#pragma once
#include "shared.h"

void controlBegin();
void controlLoop();

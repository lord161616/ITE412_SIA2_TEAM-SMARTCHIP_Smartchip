// 20x4 LCD. Only lines that changed are rewritten, so the screen doesn't flicker.
#pragma once
#include "shared.h"

struct DisplayModel {
  Snapshot snap;
  float menuTemp;          // value being edited in SET_TEMP
  uint16_t menuMinutes;    // value being edited in SET_TIME
  uint32_t preheatSeconds; // time spent preheating so far
  bool manualSsr;          // manual SSR test active (IDLE)
  CloudStatus cloud;
};

void displayBegin();
void displayShowMessage(const char* line1, const char* line2);
void displayUpdate(const DisplayModel& m);

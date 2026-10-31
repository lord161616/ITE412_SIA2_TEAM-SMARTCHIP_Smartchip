#include "display.h"
#include <LiquidCrystal_I2C.h>
#include "config.h"

static LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);
static char shown[LCD_ROWS][LCD_COLS + 1];

// Writes a line padded to the full width, only if it changed.
static void putLine(uint8_t row, const char* text) {
  char padded[LCD_COLS + 1];
  snprintf(padded, sizeof(padded), "%-20.20s", text);
  if (strcmp(padded, shown[row]) == 0) return;
  lcd.setCursor(0, row);
  lcd.print(padded);
  strcpy(shown[row], padded);
}

static void fmtTemp(char* out, size_t n, float t) {
  if (isnan(t)) snprintf(out, n, "--.-");
  else snprintf(out, n, "%.1f", t);
}

static void fmtHum(char* out, size_t n, float h) {
  if (isnan(h)) snprintf(out, n, "--");
  else snprintf(out, n, "%.0f", h);
}

// H:MM:SS for long runs, MM:SS otherwise.
static void fmtClock(char* out, size_t n, uint32_t seconds) {
  uint32_t h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60;
  if (h > 0) snprintf(out, n, "%lu:%02lu:%02lu", (unsigned long)h, (unsigned long)m, (unsigned long)s);
  else snprintf(out, n, "%02lu:%02lu", (unsigned long)m, (unsigned long)s);
}

// Top-right corner: W = online, ? = connecting, - = no Wi-Fi, ! = login problem
static char cloudChar(CloudStatus c) {
  switch (c) {
    case CloudStatus::ONLINE: return 'W';
    case CloudStatus::CONNECTING: return '?';
    case CloudStatus::AUTH_ERROR: return '!';
    default: return '-';
  }
}

static void headerLine(char* out, const char* title, CloudStatus c) {
  snprintf(out, LCD_COLS + 1, "%-19.19s%c", title, cloudChar(c));
}

static void sensorLine(char* out, const char* label, const SensorReading& r) {
  char t[8], h[6];
  fmtTemp(t, sizeof(t), r.ok ? r.temperature : NAN);
  fmtHum(h, sizeof(h), r.ok ? r.humidity : NAN);
  snprintf(out, LCD_COLS + 1, "%s:%sC H:%s%%%s", label, t, h, r.ok ? "" : " ERR");
}

void displayBegin() {
  lcd.init();
  lcd.backlight();
  lcd.clear();
  for (auto& row : shown) row[0] = '\0';
}

void displayShowMessage(const char* line1, const char* line2) {
  putLine(0, line1);
  putLine(1, line2);
  putLine(2, "");
  putLine(3, "");
}

void displayUpdate(const DisplayModel& m) {
  const Snapshot& s = m.snap;
  char l0[LCD_COLS + 1], l1[LCD_COLS + 1], l2[LCD_COLS + 1], l3[LCD_COLS + 1];
  char t[8], buf[12];
  l1[0] = l2[0] = l3[0] = '\0';

  switch (s.state) {
    case MachineState::IDLE:
      headerLine(l0, "SMARTCHIP READY", m.cloud);
      fmtTemp(t, sizeof(t), s.avgTemp);
      snprintf(l1, sizeof(l1), "T:%sC  SSR:%s", t, s.heater ? "ON" : "OFF");
      snprintf(l2, sizeof(l2), "START = MENU");
      snprintf(l3, sizeof(l3), m.manualSsr ? "SSR TEST ON (auto)" : "SSR BTN = TEST");
      break;

    case MachineState::SET_TEMP:
      headerLine(l0, "SET TEMPERATURE", m.cloud);
      snprintf(l1, sizeof(l1), "> %.0f C", m.menuTemp);
      snprintf(l2, sizeof(l2), "%.0f-%.0fC  UP/DOWN", MIN_TARGET_TEMP, MAX_TARGET_TEMP);
      snprintf(l3, sizeof(l3), "START=NEXT STOP=EXIT");
      break;

    case MachineState::SET_TIME: {
      headerLine(l0, "SET DRYING TIME", m.cloud);
      unsigned h = m.menuMinutes / 60, mi = m.menuMinutes % 60;
      if (h > 0) snprintf(l1, sizeof(l1), "> %uh %02um", h, mi);
      else snprintf(l1, sizeof(l1), "> %u min", mi);
      snprintf(l2, sizeof(l2), "UP/DOWN (hold=fast)");
      snprintf(l3, sizeof(l3), "START=GO  STOP=EXIT");
      break;
    }

    case MachineState::PREHEATING:
      fmtClock(buf, sizeof(buf), m.preheatSeconds);
      {
        char title[20];
        snprintf(title, sizeof(title), "PREHEAT %s", buf);
        headerLine(l0, title, m.cloud);
      }
      sensorLine(l1, "T1", s.s1);
      sensorLine(l2, "T2", s.s2);
      fmtTemp(t, sizeof(t), s.avgTemp);
      snprintf(l3, sizeof(l3), "%s/%.0fC SSR:%s", t, s.targetTemp, s.heater ? "ON" : "OFF");
      break;

    case MachineState::DRYING:
      fmtClock(buf, sizeof(buf), s.remainingSeconds);
      {
        char title[20];
        snprintf(title, sizeof(title), "DRYING %s", buf);
        headerLine(l0, title, m.cloud);
      }
      sensorLine(l1, "T1", s.s1);
      sensorLine(l2, "T2", s.s2);
      fmtTemp(t, sizeof(t), s.avgTemp);
      snprintf(l3, sizeof(l3), "%s/%.0fC SSR:%s", t, s.targetTemp, s.heater ? "ON" : "OFF");
      break;

    case MachineState::COMPLETE:
      headerLine(l0, "DRYING COMPLETE", m.cloud);
      fmtTemp(t, sizeof(t), s.avgTemp);
      snprintf(l1, sizeof(l1), "TEMP: %sC", t);
      snprintf(l2, sizeof(l2), "HEATER: OFF");
      snprintf(l3, sizeof(l3), "START = NEW RUN");
      break;

    case MachineState::FAULT: {
      headerLine(l0, "!!! FAULT !!!", m.cloud);
      const char* code = faultCodeName(s.fault);
      snprintf(l1, sizeof(l1), "%s", code ? code : "UNKNOWN");
      snprintf(l2, sizeof(l2), "HEATER+FAN: OFF");
      snprintf(l3, sizeof(l3), "FIX, THEN PRESS STOP");
      break;
    }
  }

  putLine(0, l0);
  putLine(1, l1);
  putLine(2, l2);
  putLine(3, l3);
}

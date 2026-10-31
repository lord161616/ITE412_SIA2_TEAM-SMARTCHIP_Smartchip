// =====================================================================
// SmartChip ESP32 – settings
// Wi-Fi password and Firebase account go in secrets.h (copy secrets.example.h).
// Limits must match src/config/constants.js and firestore.rules.
// =====================================================================
#pragma once

#define FIRMWARE_VERSION "2.0.1"
#define DEVICE_ID "SMARTCHIP-ESP32-01"

// ---------------- Pins (unchanged from your offline firmware) --------
#define SDA_PIN 21
#define SCL_PIN 22

#define START_BUTTON 32
#define STOP_BUTTON 33
#define UP_BUTTON 25
#define DOWN_BUTTON 26
#define SSR_BUTTON 18  // manual SSR test (IDLE only)

#define SSR_PIN 27  // HIGH = heater + fan ON

// ---------------- I2C devices ----------------------------------------
#define LCD_ADDR 0x27
#define LCD_COLS 20
#define LCD_ROWS 4
#define SHT31_1_ADDR 0x44
#define SHT31_2_ADDR 0x45

// ---------------- Temperature ------------------------------------------
#define DEFAULT_TARGET_TEMP 50.0f
#define MIN_TARGET_TEMP 30.0f
#define MAX_TARGET_TEMP 75.0f
// Hard cut-off: if ANY sensor reaches this, the SSR goes OFF and the
// machine faults. Checked in every state, including the manual SSR test.
#define SAFETY_MAX_TEMP 80.0f
#define HYSTERESIS 1.0f

// ---------------- Drying time ------------------------------------------
#define DEFAULT_DRYING_MINUTES 30
#define MIN_DRYING_MINUTES 1
#define MAX_DRYING_MINUTES 720  // 12 h

// Fault if preheating hasn't reached the target in this long
// (broken heater, fan not running, door open...). 0 = disabled.
#define PREHEAT_TIMEOUT_MINUTES 90

// ---------------- Sensors ----------------------------------------------
#define SENSOR_INTERVAL_MS 2000
// A sensor is only considered failed after this many bad reads IN A ROW,
// so a single glitchy I2C read doesn't abort a whole drying run.
#define SENSOR_FAIL_LIMIT 3

// ---------------- Buttons / LCD ----------------------------------------
#define DEBOUNCE_MS 40
#define REPEAT_DELAY_MS 450   // hold UP/DOWN this long to start repeating
#define REPEAT_RATE_MS 120
#define FAST_REPEAT_AFTER_MS 2000  // after holding this long, time steps by 10 min
#define MENU_TIMEOUT_MS 60000      // leave the setup menu after 1 min untouched
#define MANUAL_SSR_MAX_MS 120000   // manual SSR test switches itself off after 2 min
#define LCD_INTERVAL_MS 300

// ---------------- Cloud ------------------------------------------------
#define HEARTBEAT_MS 10000        // state + readings to Firestore
#define COMMAND_POLL_MS 4000      // check devices/{id}.command
#define COMMAND_MAX_AGE_S 120     // reject a START older than this
#define HTTP_TIMEOUT_MS 12000
#define WIFI_RETRY_MS 15000
#define AUTH_RETRY_MS 30000
#define EVENT_BUFFER_SIZE 12      // run events kept while offline

// TLS: 0 = encrypted but the server certificate isn't checked (works on
// every ESP32 core). 1 = verify with the core's built-in CA bundle
// (needs a recent arduino-esp32 3.3.x core with useBuiltinCACertBundle()).
#define TLS_VERIFY 0

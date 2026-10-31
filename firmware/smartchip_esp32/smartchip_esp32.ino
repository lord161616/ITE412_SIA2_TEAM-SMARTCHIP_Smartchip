// =====================================================================
// SMARTCHIP DEHYDRATOR – ESP32 firmware v2
//
//  * Works fully offline with the buttons + LCD (same menus as before).
//  * When Wi-Fi is available it reports to Firestore and accepts
//    START / STOP / CLEAR FAULT from the SmartChip web app.
//
//  Files:
//    config.h          pins, limits, timings
//    secrets.h         Wi-Fi + Firebase login (copy secrets.example.h)
//    control.cpp       sensors, heater, safety, buttons, state machine (core 1)
//    display.cpp       20x4 LCD
//    cloud.cpp         Wi-Fi + Firestore sync (core 0)
//    firestore.cpp     tiny Firebase REST client
//
//  Libraries (Arduino IDE > Library Manager):
//    Adafruit SHT31 Library, LiquidCrystal I2C (Frank de Brabander),
//    ArduinoJson (v7) by Benoit Blanchon
//
//  Board: ESP32 Dev Module (arduino-esp32 core 2.x or 3.x)
// =====================================================================

#include "cloud.h"
#include "config.h"
#include "control.h"
#include "shared.h"

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("==============================");
  Serial.println(" SMARTCHIP DEHYDRATOR v" FIRMWARE_VERSION);
  Serial.println("==============================");

  sharedInit();
  controlBegin();  // SSR is forced OFF first thing in here
  cloudBegin();    // starts the network task on core 0
}

void loop() {
  controlLoop();  // core 1
  delay(5);
}

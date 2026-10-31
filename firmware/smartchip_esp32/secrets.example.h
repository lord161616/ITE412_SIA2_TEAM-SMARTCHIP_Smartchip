// Copy this file to "secrets.h" (same folder) and fill it in.
// secrets.h is ignored by git, so your passwords never get committed.
#pragma once

// Wi-Fi (2.4 GHz – the ESP32 can't join 5 GHz networks)
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"

// Firebase console > Project settings > General > Web API key / Project ID
#define FIREBASE_API_KEY "AIza..."
#define FIREBASE_PROJECT_ID "your-project-id"

// The ESP32's own login (Firebase console > Authentication > Add user).
// Its UID must be listed in isDevice() in firestore.rules. See SETUP.md.
#define DEVICE_EMAIL "esp32@your-domain.com"
#define DEVICE_PASSWORD "a-long-random-password"

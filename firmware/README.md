# SmartChip ESP32 firmware v2

This is your offline firmware with the same pins, LCD menus and buttons, plus
the fixes below and Wi-Fi/Firestore support. For flashing instructions, see
[../SETUP.md](../SETUP.md), step 4.

## What changed from the offline-only version

| Before | Now |
| --- | --- |
| The 80 °C cut-off only ran while preheating/drying, so the manual SSR test in IDLE had no protection | The cut-off runs in **every** state and uses the **hottest** sensor, not the average |
| One bad SHT31 reading faulted the whole run | Faults only after **3 bad readings in a row** (6 s) |
| FAULT had no reason | Fault codes: `SENSOR_1_FAILURE`, `SENSOR_2_FAILURE`, `SENSOR_FAILURE`, `OVER_TEMPERATURE`, `PREHEAT_TIMEOUT` |
| A dead heater could preheat forever | Faults if the target isn't reached within 90 min (`PREHEAT_TIMEOUT_MINUTES`) |
| Manual SSR test stayed on until pressed again | Switches itself off after 2 min, and refuses to start with no working sensor |
| Holding START skipped through menus every 250 ms | Buttons act once per press; UP/DOWN repeat while held (fast steps of 10 min after 2 s) |
| The LCD was cleared every 500 ms (flicker) | Only changed lines are rewritten |
| The setup menu could be left open forever | Closes after 1 min untouched. STOP leaves the menu |
| The timer showed MM:SS only | H:MM:SS for long runs |

## How it's organised

```
smartchip_esp32.ino   setup() / loop()
config.h              pins, limits, timings  ← tweak here
secrets.h             Wi-Fi + Firebase login (copy secrets.example.h; not committed)
control.cpp           sensors, safety, heater, buttons, state machine   (core 1)
display.cpp           20x4 LCD
cloud.cpp             Wi-Fi, commands, heartbeats, run/batch updates    (core 0)
firestore.cpp         small Firebase Auth + Firestore REST client
shared.h/.cpp         what the two cores share (snapshot + queues)
```

Heater control runs on core 1 and **never waits for the network**. All Wi-Fi
and Firebase work happens in a separate task on core 0. If the internet is
slow or down, the dehydrator behaves exactly as it does offline.

## How it talks to the web app

The ESP32 doesn't need any Firebase library. It uses Firebase's HTTPS REST API.

- **Every 4 s** it reads `devices/SMARTCHIP-ESP32-01`. A new `command` (START, STOP or CLEAR_FAULT) is handled once.
- **Every 10 s, and on every state change,** it writes its status, both sensors, the heater state and the countdown.
- **When a run starts, reaches the target, finishes, stops or faults,** it updates the run and the inventory batch in one atomic commit. If Wi-Fi is down, up to 12 of these updates are queued and sent in order later.
- **A START is written to Firestore before the heater turns on.** If the app cancelled it a moment earlier, Firestore refuses the write and the heater never starts.
- **It rejects** a START older than 2 minutes, a START that was waiting when it booted, and any START while it's busy, in the menu, faulted, or without working sensors.
- **After a restart** it can't resume a run (its timer is gone). It marks the run failed (`power_loss`) and returns the batch to Fresh.

The full field list is in [../docs/DATA_MODEL.md](../docs/DATA_MODEL.md).

## LCD corner symbol

`W` online · `?` connecting · `-` no Wi-Fi · `!` Firebase login problem

## Security note

`TLS_VERIFY` is 0 by default: traffic is encrypted, but Google's certificate
isn't checked, which works on every ESP32 core. If your arduino-esp32 core has
`NetworkClientSecure::useBuiltinCACertBundle()` (recent 3.3.x releases), set it to 1
to verify the certificate too. If it doesn't compile with 1, set it back to 0.

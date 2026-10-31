# SmartChip – Mushroom Dehydrator

The web app and ESP32 firmware for the SmartChip dehydrator. Staff watch and
control the drying chamber, manage harvest inventory and review drying
history. Customers see the shop.

```
React web app  ── command ──▶  Firestore  ◀── state, runs, batches ──  ESP32
(this folder)  ◀── live ────                 ── command (every 4 s) ──▶ (firmware/)
```

**New install or wiped database? Follow [SETUP.md](SETUP.md).**

## Everyday commands

You need **Node.js 20.19+ or 22.12+**.

| Command | What it does |
| --- | --- |
| `npm install` | First time only |
| `npm run dev` | Local dev server at http://localhost:5173 |
| `npm run build` | Production build into `dist/` |
| `npm run lint` | Check the code |
| `npm run deploy:rules` | Upload `firestore.rules` (after any rules change) |

Deploy commands need the Firebase CLI: `npm i -g firebase-tools`, then `firebase login`.

## How it fits together

- **[docs/DATA_MODEL.md](docs/DATA_MODEL.md)** lists every Firestore field and who may write it.
  Main rule: the ESP32 owns the machine state, and the web app only writes `devices/{id}.command`.
- **[firmware/](firmware/README.md)** holds the ESP32 sketch. It works fully offline with
  the buttons and LCD, and syncs when Wi-Fi is available.
- **`firestore.rules`** enforces the data model: who can write which fields, and which status changes are allowed.

```
src/
  config/constants.js   device ID, limits, status names (match firmware/config.h + rules)
  config/navigation.js  sidebar menu + who can see each page
  lib/                  firebase setup, formatting, error messages
  services/             ALL Firestore reads/writes (pages never call Firestore directly)
    dryingService.js    start / stop / clear fault / cancel / recover
    shopService.js      listings, atomic reservations, payments, shop settings
  context/
    AuthContext.jsx     signed-in user + live profile + role flags
    DeviceContext.jsx   ONE live device connection for the whole app + trend history
    FeedbackContext.jsx confirm dialogs and toast messages
    ShopContext.jsx     live reservations for shop managers (sidebar badge + pop-ups)
  hooks/                useLiveData, useAction, useAlerts, useRunReport
  components/device/    MachinePanel (every machine action), charts, sensor tiles
  components/shop/      Storefront, ReserveModal, MyReservations, ShopManager…
  components/ui/        Card, Modal, StatusBadge, Notice…
  pages/                one file per screen
  styles/               base (colour tokens) → components → layout → pages
notifier/               free Google Apps Script: alerts (web push, Gmail, SMS, Telegram) + Add staff
firmware/               ESP32 sketch
```

## Roles

| Role | Can |
| --- | --- |
| visitor (signed out) | Browse the shop |
| customer | Shop: order with GCash pay-first (reference number required), see own orders |
| viewer | Dashboard, Alerts, Sensors, History, Analytics |
| operator | Viewer + Drying control + Inventory + **Manage shop** |
| administrator | Everything + Users + archive batches |

## Drying workflow

1. **Inventory → Add batch** (fresh weight, harvest date).
2. **Drying control.** Choose the Fresh batch, a target (30–75 °C) and a drying time (up to 12 h), then *Start drying*.
   The ESP32 accepts it, preheats, and **starts the countdown once the target is reached**.
3. **Stop drying** sends STOP. The ESP32 cuts the heater and the batch goes back to Fresh.
4. When it's done the batch becomes **Dried**. **Weigh** it in Inventory so History can show the yield.
5. If the ESP32 dies mid-run and doesn't come back, **Recover machine** unlocks after 2 minutes.
   If it does come back, it fails the old run by itself.

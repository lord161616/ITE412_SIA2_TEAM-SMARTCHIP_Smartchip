# SmartChip data model (v2)

This is the contract between the **web app**, **firestore.rules** and the **ESP32
firmware**. If you change a field here, change it in all three.

Main rule: **every field has exactly one owner.** The ESP32 writes the
machine's state. The web app writes only commands. Firestore rules enforce this.

```
web app ── writes devices/{id}.command ──▶ Firestore ◀── polls every 5 s ── ESP32
web app ◀── live listener ── Firestore ◀── writes state, runs, batch status ── ESP32
```

---

## `devices/SMARTCHIP-ESP32-01`

The ESP32 creates this document by itself the first time it connects.

### Written by the ESP32

| Field | Type | Meaning |
| --- | --- | --- |
| `deviceId` | string | `SMARTCHIP-ESP32-01` |
| `firmware` | string | Firmware version, e.g. `2.0.0` |
| `status` | string | `idle` · `setup` (someone is in the LCD menu) · `preheating` · `drying` · `completed` · `fault` |
| `runId` | string \| null | Run in progress |
| `batchId` | string \| null | Inventory batch of that run (null for button-started runs) |
| `source` | string \| null | `web` or `local` (started with the buttons) |
| `targetTemp` | number \| null | °C, during a run |
| `durationMinutes` | number \| null | Drying time, during a run |
| `remainingSeconds` | number \| null | Countdown while `drying` |
| `temperature` | number \| null | Chamber average of both SHT31s, °C |
| `humidity` | number \| null | Chamber average, % RH |
| `sensors` | map | `{ s1: {temperature, humidity, ok}, s2: {…} }` |
| `heater` | bool | SSR output (heater **and** fan) |
| `faultCode` | string \| null | See fault codes below |
| `lastCommandId` | string \| null | Last `command.id` the ESP32 handled |
| `lastCommandResult` | string \| null | `accepted`, `done`, or `rejected:<REASON>` |
| `wifiRssi` | number | Signal strength, dBm |
| `lastSeen` | timestamp | Server time of the last heartbeat (every 10 s) |
| `bootedAt` | timestamp | When the ESP32 last restarted |

### Written by the web app (operators)

| Field | Type | Meaning |
| --- | --- | --- |
| `command` | map \| null | The latest request (see below). The web app never touches any other field. |

A command is **pending** while `command.id != lastCommandId`.

```js
command: {
  id: "uuid",                 // new for every command
  type: "START" | "STOP" | "CLEAR_FAULT",
  requestedBy: "<uid>",
  requestedAt: <server timestamp>,
  // START only:
  runId: "…", batchId: "…", targetTemp: 55, durationMinutes: 480,
  // STOP only:
  runId: "…"
}
```

The ESP32 **rejects** a command if:
- it's a START older than 2 minutes (for example, sent while the device was unplugged), or
- it was already waiting when the ESP32 booted, or
- the machine is busy, or someone is using the LCD menu, or
- the sensors aren't reading.

Then `lastCommandResult = "rejected:<REASON>"`, and for a START the run is marked `failed`.

**Exception (recovery):** if the ESP32 has been silent for more than 2 minutes, an operator may force
`status: idle`, `runId: null`, `heater: false` (the *Recover* button) so a dead
ESP32 can't keep a batch locked forever.

---

## `dryingRuns/{runId}`

| Field | Type | Set by |
| --- | --- | --- |
| `deviceId` | string | creator |
| `source` | `web` \| `local` | creator |
| `batchId`, `batchNumber` | string \| null | creator (null for local runs) |
| `initialWeight` | number \| null | creator (batch fresh weight) |
| `targetTemp` | number (30–75) | creator |
| `durationMinutes` | number (1–720) | creator |
| `requestedBy` | uid or `"device"` | creator |
| `status` | `pending` → `preheating` → `drying` → `completed` / `stopped` / `failed` | ESP32 (web: only `pending` → `stopped`, or `failed` during recovery) |
| `startedAt` | timestamp \| null | ESP32: heater switched on (preheat began) |
| `dryingStartedAt` | timestamp \| null | ESP32: target reached, countdown started |
| `endedAt` | timestamp \| null | ESP32 (or web on cancel/recovery) |
| `endReason` | string \| null | `completed` · `stopped_web` · `stopped_button` · `fault` · `power_loss` · `rejected` · `expired` · `cancelled` · `recovered` |
| `faultCode` | string \| null | ESP32 |
| `finalWeight` | number \| null | web (operator weighs the dried batch) |
| `createdAt`, `updatedAt` | timestamp | |

Web-started runs are created as `pending` in the same transaction that sends
START. Button-started runs are created by the ESP32 as `local`, already `preheating`.

---

## `inventory/{batchId}`

| Field | Type | Notes |
| --- | --- | --- |
| `batchNumber` | string (≤ 50) | e.g. `OY-2026-014` |
| `freshWeight` | number > 0 | kg |
| `harvestDate` | `YYYY-MM-DD` | |
| `status` | `Fresh` → `Drying` → `Dried` → `Archived` | web: Fresh→Drying (START), Drying→Fresh (cancel/recover). ESP32: Drying→Dried (completed) or Drying→Fresh (stopped/failed) |
| `driedWeight` | number \| null | web, on Dried batches |
| `lastRunId` | string \| null | set at START |
| `createdAt`, `updatedAt` | timestamp | |

---

## Shop

### `shop/settings` (public read, shop manager writes)

`gcashNumber`, `gcashName`, `pickupAddress`, `pickupHours`, `contactPhone`, `notes` (strings), `updatedAt`.

### `products/{batchId}` (one listing per Dried batch; document ID = inventory batch ID)

| Field | Type | Notes |
| --- | --- | --- |
| `batchId`, `batchNumber` | string | copied from the batch |
| `name` | string (≤ 80) | |
| `description` | string (≤ 500) | |
| `listedGrams` | int | amount offered; ≤ the batch's `driedWeight` × 1000 |
| `availableGrams` | int | what's left to reserve. Goes down when a customer reserves, back up on cancel |
| `packages` | list of `{ grams: int, price: number }` (1–4) | e.g. `[{grams: 100, price: 130}]` |
| `published` | bool | shown on the storefront |
| `lastReservationId` | string \| null | the reservation that last changed `availableGrams` (lets the rules check stock changes) |
| `createdAt`, `updatedAt` | timestamp | |

Readable by anyone when `published`, and by any signed-in user (so a customer can still cancel after a listing is hidden). Never deleted, only hidden.

### `reservations/{id}`

| Field | Type | Notes |
| --- | --- | --- |
| `productId`, `batchId`, `batchNumber`, `productName` | string | copied from the listing |
| `packageIndex`, `packageGrams`, `unitPrice`, `quantity` | | the chosen package, × `quantity` (1–50) |
| `grams`, `total` | int, number | must equal package × quantity (checked by the rules) |
| `customerId`, `customerName`, `customerPhone`, `customerEmail` | string | |
| `pickupDate` | `YYYY-MM-DD` \| null | customer's preferred day |
| `note` | string (≤ 300) | |
| `status` | `reserved` → `ready` → `completed`; or `cancelled` | manager: all moves. Customer: `reserved` → `cancelled` before paying |
| `paymentMethod` | `gcash` \| `cash` | |
| `paymentStatus` | `unpaid` → `submitted` → `verified`, or `rejected` → `submitted` | customer: `submitted` (with reference). Only the manager sets `verified` / `rejected` |
| `paymentReference` | string \| null | GCash reference number |
| `paymentSubmittedAt`, `paymentVerifiedAt`, `paymentVerifiedBy`, `paymentNote` | | |
| `readyAt`, `completedAt`, `cancelledAt`, `cancelledBy`, `cancelReason` | | |
| `createdAt`, `updatedAt` | timestamp | |

**Atomic stock.** Reserving is one transaction: create the reservation + lower
`products.availableGrams` by exactly `grams` + set `lastReservationId`. The rules check
each side against the other with `getAfter()`, so stock can't go below 0, two people
can't get the same grams, and prices can't be changed from the browser. Cancelling
returns the grams the same way. `completed` requires `paymentStatus == verified`
(for cash, the manager records the payment when the customer collects).

---

## `users/{uid}`

| Field | Type |
| --- | --- |
| `email`, `nickname`, `phone` | string |
| `role` | `customer` · `viewer` · `operator` · `administrator` |
| `accountType` | `customer` · `staff` |
| `status` | `active` · `inactive` · `pending` |
| `createdAt`, `updatedAt`, `lastLoginAt` | timestamp |

---

## Fault codes

| Code | Meaning |
| --- | --- |
| `SENSOR_1_FAILURE` / `SENSOR_2_FAILURE` | That SHT31 failed 3 readings in a row |
| `SENSOR_FAILURE` | Both failed |
| `OVER_TEMPERATURE` | Any sensor ≥ 80 °C, heater cut |
| `PREHEAT_TIMEOUT` | Didn't reach target within the preheat limit (heater, fan or door problem) |
| `DEVICE_ERROR` | Anything else |

## Rejection reasons (`lastCommandResult = "rejected:…"`)

`BUSY` · `LOCAL_MENU` · `SENSORS_NOT_READY` · `FAULT_ACTIVE` · `EXPIRED` ·
`NOT_RUNNING` · `INVALID` · `STILL_OVER_TEMPERATURE`

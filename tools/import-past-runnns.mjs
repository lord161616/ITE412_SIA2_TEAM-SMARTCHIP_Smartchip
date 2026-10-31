// =====================================================================
// Adds past drying runs (from before the system was online) to
// Firestore, so they show in History and Analytics.
//
//   1. Put your service account key in this folder as serviceAccount.json
//      (Firebase console > Project settings > Service accounts >
//       Generate new private key). KEEP IT SECRET, never share or upload it.
//   2. cd tools
//      npm install
//      npm run import-runs
//
// Safe to run again: each run has a fixed ID, so it's updated, not duplicated.
// To remove an imported run, delete its document in the Firestore console.
// =====================================================================
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// --------------------------- EDIT HERE --------------------------------
// Times are Philippine time (UTC+8). Start times weren't recorded, so 8:00 AM
// is assumed. Change "start" if you know the real time.
// batchNumber / initialWeight (fresh kg) / finalWeight (dried kg) are optional:
// leave null if unknown. With both weights, History shows the yield.
const PAST_RUNS = [
  { id: "import-2026-09-04", start: "2026-09-04T08:00", minutes: 300, temp: 50, batchNumber: "Tita-Neri-batch-1", initialWeight: 5, finalWeight: null },
  { id: "import-2026-09-17", start: "2026-09-17T08:00", minutes: 300, temp: 50, batchNumber: "Tita-Neri-batch-2", initialWeight: 6, finalWeight: null },
  // Oct 11: four 1-hour runs with about 4-minute breaks in between.
  { id: "import-2026-10-11-1", start: "2026-10-11T08:00", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1", initialWeight: 5, finalWeight: null },
  { id: "import-2026-10-11-2", start: "2026-10-11T09:04", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1", initialWeight: 5, finalWeight: null },
  { id: "import-2026-10-11-3", start: "2026-10-11T10:08", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1", initialWeight: 5, finalWeight: null },
  { id: "import-2026-10-11-4", start: "2026-10-11T11:12", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1", initialWeight: 5, finalWeight: null },
];
// ----------------------------------------------------------------------

const key = JSON.parse(readFileSync(new URL("./serviceAccount.json", import.meta.url), "utf8"));
initializeApp({ credential: cert(key) });
const db = getFirestore();

const ts = (date) => Timestamp.fromDate(date);
const manila = (local) => new Date(`${local}:00+08:00`);

for (const r of PAST_RUNS) {
  const start = manila(r.start);
  if (Number.isNaN(start.getTime())) throw new Error(`Bad start time for ${r.id}: ${r.start}`);
  const end = new Date(start.getTime() + r.minutes * 60_000);

  await db.collection("dryingRuns").doc(r.id).set({
    deviceId: "SMARTCHIP-ESP32-01",
    source: "imported",
    batchId: null,
    batchNumber: r.batchNumber,
    initialWeight: r.initialWeight,
    targetTemp: r.temp,
    durationMinutes: r.minutes,
    requestedBy: "import",
    status: "completed",
    startedAt: ts(start), // preheat wasn't recorded, so it counts from the start
    dryingStartedAt: ts(start),
    endedAt: ts(end),
    endReason: "completed",
    faultCode: null,
    finalWeight: r.finalWeight,
    createdAt: ts(start),
    updatedAt: ts(new Date()),
  });
  console.log(`saved ${r.id}: ${r.start} for ${r.minutes} min at ${r.temp} °C`);
}
console.log(`Done. ${PAST_RUNS.length} past runs are in History.`);

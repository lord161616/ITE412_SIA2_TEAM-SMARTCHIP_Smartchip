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
// Text goes in "quotes"; numbers and null don't.
//
// INVENTORY: every run with a batchNumber also creates that batch in Inventory
// (status Dried). Runs with the SAME batchNumber become ONE batch, e.g. if
// the four Oct 11 runs were one batch, give all four the same batchNumber.
// The batch gets its fresh weight from initialWeight, its dried weight from
// finalWeight (null = shows "Weigh" in Inventory), and its harvest date from
// harvestDate ("YYYY-MM-DD"), or the first run's date if you leave it out.
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
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const batchIdFor = (r) => (r.batchNumber ? `import-batch-${slug(r.batchNumber)}` : null);

// ---------- Inventory batches (one per batchNumber) ----------
const batches = new Map();
for (const r of [...PAST_RUNS].sort((a, b) => a.start.localeCompare(b.start))) {
  if (!r.batchNumber) continue;
  const b = batches.get(r.batchNumber) ?? { runs: [], fresh: null, dried: null, harvest: null };
  b.runs.push(r);
  b.fresh ??= r.initialWeight;
  if (r.finalWeight != null) b.dried = r.finalWeight; // last run's dried weight wins
  b.harvest ??= r.harvestDate ?? null;
  batches.set(r.batchNumber, b);
}

for (const [batchNumber, b] of batches) {
  const id = `import-batch-${slug(batchNumber)}`;
  if (!(Number(b.fresh) > 0)) {
    console.log(`! batch "${batchNumber}" skipped: give its runs an initialWeight (fresh kg) above 0`);
    continue;
  }
  const first = manila(b.runs[0].start);
  const last = b.runs[b.runs.length - 1];
  await db.collection("inventory").doc(id).set({
    batchNumber,
    freshWeight: Number(b.fresh),
    harvestDate: b.harvest ?? b.runs[0].start.slice(0, 10),
    status: "Dried",
    driedWeight: b.dried == null ? null : Number(b.dried),
    lastRunId: last.id,
    createdAt: ts(first),
    updatedAt: ts(new Date()),
  });
  console.log(`saved batch "${batchNumber}" (${b.runs.length} run${b.runs.length > 1 ? "s" : ""}, ${b.fresh} kg fresh)`);
}

// ---------- Drying runs ----------
for (const r of PAST_RUNS) {
  const start = manila(r.start);
  if (Number.isNaN(start.getTime())) throw new Error(`Bad start time for ${r.id}: ${r.start}`);
  const end = new Date(start.getTime() + r.minutes * 60_000);

  await db.collection("dryingRuns").doc(r.id).set({
    deviceId: "SMARTCHIP-ESP32-01",
    source: "imported",
    batchId: batches.has(r.batchNumber) && Number(batches.get(r.batchNumber).fresh) > 0 ? batchIdFor(r) : null,
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
console.log(`Done. ${PAST_RUNS.length} past runs are in History, ${batches.size} batch(es) in Inventory.`);

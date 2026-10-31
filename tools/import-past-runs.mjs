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
// The database is made to MATCH this list: running it again updates runs,
// and deletes earlier imported runs / batches that are no longer in the list.
// (It only ever touches things this script created; real runs are never touched.)
// To remove everything it imported, empty the list (const PAST_RUNS = [];) and run it.
// =====================================================================
import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// --------------------------- EDIT HERE --------------------------------
// Times are Philippine time (UTC+8), 24-hour clock: 1:38 PM = "13:38".
// batchNumber / initialWeight (fresh kg) / finalWeight (dried kg) are optional:
// leave null if unknown. With both weights, History shows the yield.
// Text goes in "quotes"; numbers and null don't.
//
// INVENTORY: every run with a batchNumber also creates that batch in Inventory
// (status Dried). Runs with the SAME batchNumber become ONE batch, e.g. if
// the four Oct 11 runs were one batch, give all four the same batchNumber.
// The batch gets its fresh weight from initialWeight (optional), its dried weight from
// finalWeight (null = shows "Weigh" in Inventory), and its harvest date from
// harvestDate ("YYYY-MM-DD"), or the first run's date if you leave it out.
const PAST_RUNS = [
  { id: "import-2026-09-04", start: "2026-09-04T08:00", minutes: 300, temp: 50, batchNumber: "Tita-Neri-batch-1", initialWeight: 5, finalWeight: null },
  { id: "import-2026-09-17", start: "2026-09-17T08:00", minutes: 300, temp: 50, batchNumber: "Tita-Neri-batch-2", initialWeight: null, finalWeight: null },
  // Oct 11: four separate 1-hour runs, one Inventory entry each.
  // Fresh weight (kg) in initialWeight, dried weight in finalWeight, if you know them.
  { id: "import-2026-10-11-1", start: "2026-10-11T12:36", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1 part 1", initialWeight: null, finalWeight: null },
  { id: "import-2026-10-11-2", start: "2026-10-11T13:38", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1 part 2", initialWeight: null, finalWeight: null },
  { id: "import-2026-10-11-3", start: "2026-10-11T14:41", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1 part 3", initialWeight: null, finalWeight: null },
  { id: "import-2026-10-11-4", start: "2026-10-11T15:45", minutes: 60, temp: 50, batchNumber: "glenn-supervision-batch1 part 4", initialWeight: null, finalWeight: null },
];
// ----------------------------------------------------------------------

const key = JSON.parse(readFileSync(new URL("./serviceAccount.json", import.meta.url), "utf8"));
initializeApp({ credential: cert(key) });
const db = getFirestore();

const ts = (date) => Timestamp.fromDate(date);
const manila = (local) => new Date(`${local}:00+08:00`);
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const batchIdFor = (r) => (r.batchNumber ? `import-batch-${slug(r.batchNumber)}` : null);

// ---------- Check the list before writing anything ----------
const problems = [];
const ids = new Set();
for (const r of PAST_RUNS) {
  if (ids.has(r.id)) problems.push(`two runs have the id "${r.id}"`);
  ids.add(r.id);
  if (!r.id.startsWith("import-")) problems.push(`id "${r.id}" must start with "import-"`);
  if (Number.isNaN(manila(r.start).getTime())) problems.push(`${r.id}: start "${r.start}" should look like "2026-10-11T13:38"`);
  if (!(Number(r.minutes) > 0)) problems.push(`${r.id}: minutes must be above 0`);
  if (r.initialWeight != null && !(Number(r.initialWeight) > 0)) problems.push(`${r.id}: initialWeight must be a number above 0, or null`);
  if (r.finalWeight != null && !(Number(r.finalWeight) >= 0)) problems.push(`${r.id}: finalWeight must be a number, or null`);
}
if (problems.length) {
  console.log("Nothing was saved. Fix these in the list first:");
  problems.forEach((p) => console.log(`  - ${p}`));
  process.exit(1);
}

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
  const first = manila(b.runs[0].start);
  const last = b.runs[b.runs.length - 1];
  await db.collection("inventory").doc(id).set({
    batchNumber,
    freshWeight: b.fresh == null ? null : Number(b.fresh), // null shows "--" in Inventory
    harvestDate: b.harvest ?? b.runs[0].start.slice(0, 10),
    status: "Dried",
    driedWeight: b.dried == null ? null : Number(b.dried),
    lastRunId: last.id,
    createdAt: ts(first),
    updatedAt: ts(new Date()),
  });
  console.log(`saved batch "${batchNumber}" (${b.runs.length} run${b.runs.length > 1 ? "s" : ""}, ${b.fresh == null ? "no fresh weight yet" : `${b.fresh} kg fresh`})`);
}

// ---------- Drying runs ----------
for (const r of PAST_RUNS) {
  const start = manila(r.start);
  if (Number.isNaN(start.getTime())) throw new Error(`Bad start time for ${r.id}: ${r.start}`);
  const end = new Date(start.getTime() + r.minutes * 60_000);

  await db.collection("dryingRuns").doc(r.id).set({
    deviceId: "SMARTCHIP-ESP32-01",
    source: "imported",
    batchId: batchIdFor(r),
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
// ---------- Remove earlier imports that are no longer in the list ----------
const keepRuns = new Set(PAST_RUNS.map((r) => r.id));
const keepBatches = new Set([...batches.keys()].map((n) => `import-batch-${slug(n)}`));

const oldRuns = await db.collection("dryingRuns").where("source", "==", "imported").get();
for (const d of oldRuns.docs) {
  if (keepRuns.has(d.id)) continue;
  await d.ref.delete();
  console.log(`deleted old run ${d.id}`);
}

const inventory = await db.collection("inventory").get();
for (const d of inventory.docs) {
  if (!d.id.startsWith("import-batch-") || keepBatches.has(d.id)) continue;
  if ((await db.collection("products").doc(d.id).get()).exists) {
    console.log(`kept old batch "${d.data().batchNumber}": it has a shop listing (hide it in Manage shop instead)`);
    continue;
  }
  await d.ref.delete();
  console.log(`deleted old batch "${d.data().batchNumber}"`);
}

console.log(`Done. ${PAST_RUNS.length} past runs in History, ${batches.size} batch(es) in Inventory.`);

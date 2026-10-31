import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { BATCH, COLLECTIONS } from "../config/constants";
import { AppError } from "../lib/errors";
import { db } from "../lib/firebase";
import { toDate } from "../lib/format";

const inventoryCol = collection(db, COLLECTIONS.inventory);
const batchRef = (id) => doc(db, COLLECTIONS.inventory, id);

/** Live inventory list, newest first. */
export function subscribeToInventory(onData, onError) {
  return onSnapshot(
    inventoryCol,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
      onData(items);
    },
    onError,
  );
}

function validateBatch({ batchNumber, freshWeight, harvestDate }) {
  const number = String(batchNumber ?? "").trim();
  const weight = Number(freshWeight);
  const date = String(harvestDate ?? "").trim();
  if (!number) throw new AppError("Batch ID is required.");
  if (number.length > 50) throw new AppError("Batch ID cannot exceed 50 characters.");
  if (!Number.isFinite(weight) || weight <= 0) throw new AppError("Fresh weight must be greater than 0 kg.");
  if (!date) throw new AppError("Harvest date is required.");
  return { batchNumber: number, freshWeight: weight, harvestDate: date };
}

export function createBatch(data) {
  const clean = validateBatch(data);
  return addDoc(inventoryCol, {
    ...clean,
    status: BATCH.FRESH,
    driedWeight: null,
    lastRunId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Only Fresh batches can be edited (enforced by firestore.rules too). */
export function updateBatch(id, data) {
  const clean = validateBatch(data);
  return updateDoc(batchRef(id), { ...clean, updatedAt: serverTimestamp() });
}

/** Administrators only; Fresh or Dried batches. */
export function archiveBatch(id) {
  return updateDoc(batchRef(id), { status: BATCH.ARCHIVED, updatedAt: serverTimestamp() });
}

/**
 * Saves the weighed dried weight of a Dried batch, and copies it to the
 * batch's last (completed) run as finalWeight so History can show the yield.
 */
export async function recordDriedWeight({ batchId, runId, driedWeight }) {
  const weight = Number(driedWeight);
  if (!Number.isFinite(weight) || weight < 0) throw new AppError("Dried weight must be 0 kg or more.");

  const batch = writeBatch(db);
  batch.update(batchRef(batchId), { driedWeight: weight, updatedAt: serverTimestamp() });
  if (runId) {
    batch.update(doc(db, COLLECTIONS.dryingRuns, runId), {
      finalWeight: weight,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

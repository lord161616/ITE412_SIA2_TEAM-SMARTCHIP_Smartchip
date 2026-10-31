/**
 * Drying run workflow (data model v2, see docs/DATA_MODEL.md).
 *
 * The web app only ever *asks*: it writes devices/{id}.command. The ESP32
 * does the work and updates the device, the run and the batch itself.
 * Each function below is one transaction that matches a rule in firestore.rules.
 *
 *   startDryingRun()   create run (pending) + batch Fresh->Drying + START command
 *   stopDryingRun()    STOP command
 *   clearFault()       CLEAR_FAULT command
 *   cancelStart()      START not accepted yet: run -> stopped, batch -> Fresh, command cleared
 *   recoverMachine()   ESP32 silent > 2 min: force device idle, fail the run, batch -> Fresh
 */
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import {
  BATCH,
  COLLECTIONS,
  COMMANDS,
  DEVICE_ID,
  DURATION_LIMITS,
  FINISHED_RUN_STATUSES,
  READY_STATUSES,
  RUN,
  TEMP_LIMITS,
} from "../config/constants";
import { AppError } from "../lib/errors";
import { db } from "../lib/firebase";
import { toDate } from "../lib/format";
import { deviceRef } from "./deviceService";

const runsCol = collection(db, COLLECTIONS.dryingRuns);
const runRef = (id) => doc(db, COLLECTIONS.dryingRuns, id);
const batchRef = (id) => doc(db, COLLECTIONS.inventory, id);

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const isPending = (device) => Boolean(device.command && device.command.id !== device.lastCommandId);

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** Live list of all drying runs, newest first. */
export function subscribeToRuns(onData, onError) {
  return onSnapshot(
    runsCol,
    (snap) => {
      const runs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      runs.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
      onData(runs);
    },
    onError,
  );
}

/** Live single run (null if it doesn't exist). */
export function subscribeToRun(runId, onData, onError) {
  return onSnapshot(
    runRef(runId),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  );
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Returns an error message, or null when the settings are fine. */
export function validateRunSettings({ targetTemp, durationMinutes }) {
  const temp = Number(targetTemp);
  const minutes = Number(durationMinutes);
  if (!Number.isFinite(temp) || temp < TEMP_LIMITS.min || temp > TEMP_LIMITS.max) {
    return `Target temperature must be between ${TEMP_LIMITS.min} and ${TEMP_LIMITS.max} °C.`;
  }
  if (!Number.isInteger(minutes) || minutes < DURATION_LIMITS.minMinutes || minutes > DURATION_LIMITS.maxMinutes) {
    return `Drying time must be between ${DURATION_LIMITS.minMinutes} minute and ${DURATION_LIMITS.maxMinutes / 60} hours.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function readDevice(tx) {
  const snap = await tx.get(deviceRef);
  if (!snap.exists()) throw new AppError("The ESP32 hasn't connected to Firestore yet.");
  return snap.data();
}

export async function startDryingRun({ batchId, targetTemp, durationMinutes, uid }) {
  if (!batchId) throw new AppError("Choose a Fresh batch to dry.");
  if (!uid) throw new AppError("Your session has expired. Please sign in again.");
  const problem = validateRunSettings({ targetTemp, durationMinutes });
  if (problem) throw new AppError(problem);

  const temp = Number(targetTemp);
  const minutes = Number(durationMinutes);
  const run = doc(runsCol); // id generated up front so transaction retries reuse it

  return runTransaction(db, async (tx) => {
    const device = await readDevice(tx);
    if (!READY_STATUSES.includes(device.status) || device.runId) {
      throw new AppError(`The machine isn't ready (status: ${device.status || "unknown"}).`);
    }
    if (isPending(device)) throw new AppError(`A ${device.command.type} command is still waiting for the ESP32.`);

    const batchSnap = await tx.get(batchRef(batchId));
    if (!batchSnap.exists()) throw new AppError("That inventory batch no longer exists.");
    const batch = batchSnap.data();
    if (batch.status !== BATCH.FRESH) throw new AppError("Only Fresh batches can be dried.");

    tx.set(run, {
      deviceId: DEVICE_ID,
      source: "web",
      batchId,
      batchNumber: batch.batchNumber,
      initialWeight: Number(batch.freshWeight) || null,
      targetTemp: temp,
      durationMinutes: minutes,
      status: RUN.PENDING,
      requestedBy: uid,
      startedAt: null,
      dryingStartedAt: null,
      endedAt: null,
      endReason: null,
      faultCode: null,
      finalWeight: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    tx.update(batchRef(batchId), { status: BATCH.DRYING, lastRunId: run.id, updatedAt: serverTimestamp() });

    tx.update(deviceRef, {
      command: {
        id: newId(),
        type: COMMANDS.START,
        requestedBy: uid,
        requestedAt: serverTimestamp(),
        runId: run.id,
        batchId,
        targetTemp: temp,
        durationMinutes: minutes,
      },
    });

    return { runId: run.id, batchNumber: batch.batchNumber };
  });
}

export async function stopDryingRun({ runId, uid }) {
  return runTransaction(db, async (tx) => {
    const device = await readDevice(tx);
    if (!device.runId || device.runId !== runId) throw new AppError("This run is no longer running on the machine.");
    if (isPending(device) && device.command.type === COMMANDS.STOP) {
      throw new AppError("STOP was already sent. Waiting for the ESP32.");
    }
    tx.update(deviceRef, {
      command: { id: newId(), type: COMMANDS.STOP, requestedBy: uid, requestedAt: serverTimestamp(), runId },
    });
  });
}

export async function clearFault({ uid }) {
  return runTransaction(db, async (tx) => {
    const device = await readDevice(tx);
    if (device.status !== "fault") throw new AppError("The machine is not in fault.");
    tx.update(deviceRef, {
      command: { id: newId(), type: COMMANDS.CLEAR_FAULT, requestedBy: uid, requestedAt: serverTimestamp() },
    });
  });
}

/** Withdraw a START the ESP32 hasn't accepted yet (e.g. it's offline). */
export async function cancelStart() {
  return runTransaction(db, async (tx) => {
    const device = await readDevice(tx);
    const command = device.command;
    if (!command || command.type !== COMMANDS.START || !isPending(device)) {
      throw new AppError("There's no waiting START to cancel.");
    }
    const runSnap = await tx.get(runRef(command.runId));
    const run = runSnap.exists() ? runSnap.data() : null;
    if (!run || run.status !== RUN.PENDING) throw new AppError("The ESP32 already picked this run up.");
    const batchSnap = await tx.get(batchRef(run.batchId));

    tx.update(runRef(command.runId), {
      status: RUN.STOPPED,
      endReason: "cancelled",
      endedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (batchSnap.exists() && batchSnap.data().status === BATCH.DRYING) {
      tx.update(batchRef(run.batchId), { status: BATCH.FRESH, updatedAt: serverTimestamp() });
    }
    tx.update(deviceRef, { command: null });
  });
}

/**
 * Firestore-only cleanup for an ESP32 that died mid-run and isn't coming
 * back. It does NOT touch the hardware: check the heater is off first.
 * Firestore rules only allow it after 2 minutes without a heartbeat.
 * (If the ESP32 does come back, it fails the old run by itself.)
 */
export async function recoverMachine() {
  return runTransaction(db, async (tx) => {
    const device = await readDevice(tx);
    const runId = device.runId || (device.command?.type === COMMANDS.START ? device.command.runId : null);

    // All reads before any writes.
    const runSnap = runId ? await tx.get(runRef(runId)) : null;
    const run = runSnap?.exists() ? runSnap.data() : null;
    const batchId = run?.batchId ?? device.batchId ?? null;
    const batchSnap = batchId ? await tx.get(batchRef(batchId)) : null;

    if (run && !FINISHED_RUN_STATUSES.includes(run.status)) {
      tx.update(runRef(runId), {
        status: RUN.FAILED,
        endReason: "recovered",
        endedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (batchSnap?.exists() && batchSnap.data().status === BATCH.DRYING) {
        tx.update(batchRef(batchId), { status: BATCH.FRESH, updatedAt: serverTimestamp() });
      }
    }

    tx.update(deviceRef, {
      status: "idle",
      runId: null,
      batchId: null,
      source: null,
      targetTemp: null,
      durationMinutes: null,
      remainingSeconds: null,
      heater: false,
      faultCode: null,
      command: null,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Helpers for the UI                                                  */
/* ------------------------------------------------------------------ */

/**
 * Countdown for a run. The timer starts when the target temperature is
 * reached (dryingStartedAt), exactly like the ESP32. Computed from the start
 * time so it ticks smoothly between heartbeats; falls back to the ESP32's
 * remainingSeconds.
 */
export function getRunProgress(run, now = Date.now(), deviceRemainingSeconds = null) {
  const totalSeconds = Math.round(Number(run?.durationMinutes || 0) * 60);
  if (!run || totalSeconds <= 0) return { phase: "unknown", percent: 0, remainingSeconds: null, endsAt: null };

  if (run.status === RUN.COMPLETED) {
    return { phase: "done", percent: 100, remainingSeconds: 0, endsAt: toDate(run.endedAt) };
  }
  if (run.status === RUN.PENDING) return { phase: "pending", percent: 0, remainingSeconds: totalSeconds, endsAt: null };

  const dryingStart = toDate(run.dryingStartedAt);
  if (run.status === RUN.PREHEATING || !dryingStart) {
    if (run.status === RUN.DRYING && deviceRemainingSeconds !== null) {
      const done = totalSeconds - deviceRemainingSeconds;
      return { phase: "drying", percent: (done / totalSeconds) * 100, remainingSeconds: deviceRemainingSeconds, endsAt: null };
    }
    return { phase: "preheating", percent: 0, remainingSeconds: totalSeconds, endsAt: null };
  }

  const endsAt = new Date(dryingStart.getTime() + totalSeconds * 1000);
  const remainingSeconds = Math.max(0, Math.round((endsAt.getTime() - now) / 1000));
  const percent = Math.min(100, Math.max(0, ((totalSeconds - remainingSeconds) / totalSeconds) * 100));
  return { phase: "drying", percent, remainingSeconds, endsAt };
}

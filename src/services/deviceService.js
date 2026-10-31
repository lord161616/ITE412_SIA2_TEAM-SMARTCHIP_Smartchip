import { doc, onSnapshot } from "firebase/firestore";
import { COLLECTIONS, DEVICE_ID, FAULT_MESSAGES, MACHINE, READY_STATUSES, REJECT_MESSAGES } from "../config/constants";
import { db } from "../lib/firebase";
import { toDate, toNumber } from "../lib/format";

export const deviceRef = doc(db, COLLECTIONS.devices, DEVICE_ID);

/** Live raw device document (null when it doesn't exist yet). */
export function subscribeToDevice(onData, onError) {
  return onSnapshot(
    deviceRef,
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  );
}

const SENSORS = [
  { key: "s1", label: "SHT31 #1", location: "Chamber sensor 1" },
  { key: "s2", label: "SHT31 #2", location: "Chamber sensor 2" },
];

/**
 * Turns the raw device document (docs/DATA_MODEL.md) into one predictable
 * shape for the UI. Online/offline is added by DeviceContext, which owns the clock.
 */
export function normalizeDevice(raw) {
  if (!raw) return null;

  const sensors = SENSORS.map(({ key, label, location }) => {
    const s = raw.sensors?.[key] ?? {};
    const temperature = toNumber(s.temperature);
    const humidity = toNumber(s.humidity);
    return { key, label, location, temperature, humidity, ok: s.ok === true && temperature !== null };
  });

  const command = raw.command && typeof raw.command === "object" ? raw.command : null;
  const pendingCommand = command && command.id !== raw.lastCommandId ? command : null;

  // Result of the most recent command we sent, if the ESP32 has answered it.
  let commandResult = null;
  if (command && command.id === raw.lastCommandId && typeof raw.lastCommandResult === "string") {
    const [result, reason] = raw.lastCommandResult.split(":");
    commandResult = {
      type: command.type,
      at: toDate(command.requestedAt),
      ok: result !== "rejected",
      reason: reason || null,
      message: reason ? REJECT_MESSAGES[reason] ?? reason : null,
    };
  }

  const status = typeof raw.status === "string" ? raw.status : null;
  const faultCode = raw.faultCode || null;

  return {
    deviceId: raw.deviceId || raw.id || DEVICE_ID,
    firmware: raw.firmware || null,
    status,
    lastSeen: toDate(raw.lastSeen),
    bootedAt: toDate(raw.bootedAt),
    wifiRssi: toNumber(raw.wifiRssi),

    runId: raw.runId || null,
    batchId: raw.batchId || null,
    source: raw.source || null,
    targetTemp: toNumber(raw.targetTemp),
    durationMinutes: toNumber(raw.durationMinutes),
    remainingSeconds: toNumber(raw.remainingSeconds),

    temperature: toNumber(raw.temperature),
    humidity: toNumber(raw.humidity),
    sensors,
    heaterOn: raw.heater === true,

    fault:
      status === MACHINE.FAULT || faultCode
        ? { code: faultCode, message: FAULT_MESSAGES[faultCode] ?? "The controller reported a fault." }
        : null,

    pendingCommand: pendingCommand
      ? { ...pendingCommand, requestedAt: toDate(pendingCommand.requestedAt) }
      : null,
    commandResult,
  };
}

/** Can a new run be started right now (ignoring online/offline)? */
export function isReadyForRun(device) {
  return Boolean(device && READY_STATUSES.includes(device.status) && !device.runId && !device.pendingCommand);
}

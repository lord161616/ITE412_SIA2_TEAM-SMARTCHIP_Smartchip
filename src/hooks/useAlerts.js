import { useMemo } from "react";
import { COMMAND_SLOW_MS, CONNECTION, MACHINE, TEMP_LIMITS } from "../config/constants";
import { useDevice } from "../context/DeviceContext";
import { formatTemp, toNumber } from "../lib/format";

/** Degrees above target before we warn. */
const OVER_TARGET_MARGIN = 5;

/**
 * Live alerts worked out from the current device state.
 * level: error | warning | info | success
 */
export default function useAlerts() {
  const { connection, online, device, activeRun, now } = useDevice();

  return useMemo(() => {
    const alerts = [];
    const add = (id, level, title, message) => alerts.push({ id, level, title, message });

    if (connection === CONNECTION.ERROR) add("conn-error", "error", "Can't read device status", "Firestore refused or failed the device listener.");
    if (connection === CONNECTION.MISSING) add("device-missing", "info", "Device not set up", "The ESP32 hasn't connected to Firestore yet.");
    if (!device) return alerts;

    const running = Boolean(device.runId) || [MACHINE.PREHEATING, MACHINE.DRYING].includes(device.status);

    if (!online) {
      add(
        "offline",
        running ? "error" : "warning",
        "Dehydrator offline",
        running
          ? "The ESP32 stopped reporting during a run. Check the device; use Recover on the Dashboard if it won't come back."
          : "No heartbeat from the ESP32 for over 45 seconds.",
      );
    }

    if (device.fault) {
      add("fault", "error", `Machine fault${device.fault.code ? `: ${device.fault.code}` : ""}`, device.fault.message);
    }

    const temp = toNumber(device.temperature);
    const hottest = Math.max(...device.sensors.map((s) => s.temperature ?? -Infinity), temp ?? -Infinity);
    if (online && Number.isFinite(hottest)) {
      if (hottest >= TEMP_LIMITS.hardSafety) {
        add("over-safety", "error", "Over safety temperature", `A sensor reads ${formatTemp(hottest)}, at or above the ${TEMP_LIMITS.hardSafety} °C cut-off.`);
      } else if (running && device.targetTemp !== null && temp !== null && temp > device.targetTemp + OVER_TARGET_MARGIN) {
        add("over-target", "warning", "Running hot", `Chamber at ${formatTemp(temp)}, more than ${OVER_TARGET_MARGIN} °C above the ${formatTemp(device.targetTemp, 0)} target.`);
      }
    }

    if (online) {
      device.sensors
        .filter((s) => !s.ok)
        .forEach((s) => add(`sensor-${s.key}`, running ? "error" : "warning", `${s.label} not reading`, `${s.location} isn't giving valid values. The machine won't start (or will fault) until it does.`));
    }

    const pending = device.pendingCommand;
    if (pending?.requestedAt && now - pending.requestedAt.getTime() > COMMAND_SLOW_MS) {
      add("command-slow", "warning", `${pending.type} not handled yet`, "The ESP32 hasn't picked up the last command. Check that it's powered and on Wi-Fi.");
    }

    if (device.commandResult && !device.commandResult.ok && device.commandResult.at && now - device.commandResult.at.getTime() < 10 * 60_000) {
      add("command-rejected", "warning", `ESP32 rejected ${device.commandResult.type}`, `Reason: ${device.commandResult.message}.`);
    }

    if (device.status === MACHINE.COMPLETED) {
      add("completed", "success", `Drying finished${activeRun?.batchNumber ? `: ${activeRun.batchNumber}` : ""}`, "Weigh the dried batch and record it in Inventory.");
    }

    return alerts;
  }, [connection, online, device, activeRun, now]);
}

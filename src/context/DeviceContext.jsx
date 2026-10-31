import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CONNECTION, DEVICE_OFFLINE_AFTER_MS } from "../config/constants";
import { getErrorMessage } from "../lib/errors";
import { normalizeDevice, subscribeToDevice } from "../services/deviceService";
import { subscribeToRun } from "../services/dryingService";
import { useAuth } from "./AuthContext";

const DeviceContext = createContext(null);

/** How many readings the in-browser trend keeps (~1 per heartbeat). */
const HISTORY_LIMIT = 720;

const EMPTY_FEED = {
  raw: undefined, // undefined = loading, null = document missing
  error: null,
  lastSeenMs: null,
  receivedAt: null, // when WE saw lastSeen change (our clock)
  subscribedAt: 0,
  history: [],
};

/**
 * ONE live connection to the device document (and its active run) for the
 * whole app. Pages read from here instead of opening their own listeners, so
 * the trend history survives moving between pages.
 *
 * Online detection doesn't trust the computer's clock alone: once a heartbeat
 * (lastSeen change) has been seen, "online" means "a heartbeat arrived in the
 * last 60 s", which works even if this PC's clock is wrong.
 */
export function DeviceProvider({ children }) {
  const { isStaff } = useAuth();
  const [feed, setFeed] = useState(EMPTY_FEED);
  const [runFeed, setRunFeed] = useState({ id: null, run: null });
  const [now, setNow] = useState(() => Date.now());

  // Device document
  useEffect(() => {
    if (!isStaff) return undefined;
    const subscribedAt = Date.now();

    const unsubscribe = subscribeToDevice(
      (data) => {
        const receivedNow = Date.now();
        setFeed((prev) => {
          const lastSeenMs = data?.lastSeen?.toMillis?.() ?? null;
          const isFirst = prev.subscribedAt !== subscribedAt;
          const base = isFirst ? { ...EMPTY_FEED, subscribedAt } : prev;
          const newHeartbeat = !isFirst && lastSeenMs !== null && lastSeenMs !== base.lastSeenMs;
          const freshByClock = lastSeenMs !== null && receivedNow - lastSeenMs < DEVICE_OFFLINE_AFTER_MS;

          let history = base.history;
          const reading = normalizeDevice(data);
          if (
            reading &&
            (newHeartbeat || (isFirst && freshByClock)) &&
            (reading.temperature !== null || reading.humidity !== null)
          ) {
            history = [
              ...history,
              { time: receivedNow, temperature: reading.temperature, humidity: reading.humidity },
            ].slice(-HISTORY_LIMIT);
          }

          return {
            ...base,
            raw: data,
            error: null,
            lastSeenMs,
            receivedAt: newHeartbeat ? receivedNow : base.receivedAt,
            history,
          };
        });
        setNow(receivedNow);
      },
      (err) => {
        console.error("Device listener error:", err);
        setFeed((prev) => ({
          ...prev,
          raw: null,
          error: getErrorMessage(err, "Unable to read the device status."),
        }));
      },
    );

    // Re-check "online" every few seconds even when nothing changes.
    const timer = setInterval(() => setNow(Date.now()), 5000);

    return () => {
      unsubscribe();
      clearInterval(timer);
      setFeed(EMPTY_FEED);
    };
  }, [isStaff]);

  const device = useMemo(() => normalizeDevice(feed.raw), [feed.raw]);

  // Active run document (target temp, start time, batch number...)
  // The run the machine is on, or the one a waiting START is for.
  const activeRunId = isStaff ? (device?.runId ?? device?.pendingCommand?.runId ?? null) : null;
  useEffect(() => {
    if (!activeRunId) return undefined;
    return subscribeToRun(
      activeRunId,
      (run) => setRunFeed({ id: activeRunId, run }),
      (err) => {
        console.error("Active run listener error:", err);
        setRunFeed({ id: activeRunId, run: null });
      },
    );
  }, [activeRunId]);
  const activeRun = activeRunId && runFeed.id === activeRunId ? runFeed.run : null;

  const value = useMemo(() => {
    let online = false;
    if (feed.raw) {
      if (feed.receivedAt) {
        online = now - feed.receivedAt < DEVICE_OFFLINE_AFTER_MS;
      } else if (feed.lastSeenMs !== null) {
        // No heartbeat seen yet since connecting: trust the clock for one window only.
        online =
          now - feed.lastSeenMs < DEVICE_OFFLINE_AFTER_MS &&
          now - feed.subscribedAt < DEVICE_OFFLINE_AFTER_MS;
      }
    }

    let connection = CONNECTION.LOADING;
    if (!isStaff) connection = CONNECTION.LOADING;
    else if (feed.error) connection = CONNECTION.ERROR;
    else if (feed.raw === null) connection = CONNECTION.MISSING;
    else if (feed.raw) connection = online ? CONNECTION.ONLINE : CONNECTION.OFFLINE;

    return {
      connection,
      online: connection === CONNECTION.ONLINE,
      loading: connection === CONNECTION.LOADING,
      error: feed.error,
      device: isStaff ? device : null, // null until the document exists
      activeRun,
      history: feed.history,
      now,
      clearHistory: () => setFeed((prev) => ({ ...prev, history: [] })),
    };
  }, [feed, now, isStaff, device, activeRun]);

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice() {
  const context = useContext(DeviceContext);
  if (!context) throw new Error("useDevice must be used inside <DeviceProvider>");
  return context;
}

import { useCallback, useState } from "react";
import { useFeedback } from "../context/FeedbackContext";
import { getErrorMessage } from "../lib/errors";

/**
 * Wraps an async action with: optional confirm dialog, a busy flag, and a
 * success / error toast. Removes the try/catch/finally boilerplate from pages.
 *
 *   const [stop, stopping] = useAction(stopDryingRun, {
 *     confirm: { title: "Stop drying?", danger: true, confirmLabel: "Stop" },
 *     success: "STOP sent. Waiting for the ESP32…",
 *   });
 *   <button onClick={() => stop(runId)} disabled={stopping}>Stop</button>
 */
export default function useAction(action, { confirm, success, onSuccess } = {}) {
  const { confirm: ask, toast } = useFeedback();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (...args) => {
      if (confirm) {
        const options = typeof confirm === "function" ? confirm(...args) : confirm;
        // A confirm function may return nothing to skip the question this time.
        if (options && !(await ask(options))) return undefined;
      }
      setBusy(true);
      try {
        const result = await action(...args);
        if (success) toast.success(typeof success === "function" ? success(result, ...args) : success);
        onSuccess?.(result, ...args);
        return result;
      } catch (error) {
        console.error(error);
        toast.error(getErrorMessage(error));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [action, confirm, success, onSuccess, ask, toast],
  );

  return [run, busy];
}

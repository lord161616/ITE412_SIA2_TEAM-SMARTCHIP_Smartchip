import { useMemo } from "react";
import { RUN } from "../config/constants";
import { toDate, toNumber } from "../lib/format";
import { subscribeToRuns } from "../services/dryingService";
import { subscribeToInventory } from "../services/inventoryService";
import useLiveData from "./useLiveData";

/**
 * All drying runs joined with their inventory batch, with the numbers the
 * History and Analytics pages need worked out once.
 */
export default function useRunReport() {
  const runs = useLiveData(subscribeToRuns);
  const inventory = useLiveData(subscribeToInventory);

  const rows = useMemo(() => {
    const batches = Object.fromEntries(inventory.data.map((b) => [b.id, b]));
    return runs.data.map((run) => {
      const batch = batches[run.batchId];
      const initial = toNumber(run.initialWeight) ?? toNumber(batch?.freshWeight);
      const final = toNumber(run.finalWeight) ?? (run.status === RUN.COMPLETED ? toNumber(batch?.driedWeight) : null);
      const start = toDate(run.dryingStartedAt) ?? toDate(run.startedAt);
      const end = toDate(run.endedAt);
      return {
        ...run,
        initial,
        final,
        yieldPct: initial && final !== null ? (final / initial) * 100 : null,
        start,
        end,
        actualHours: start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null,
        plannedHours: toNumber(run.durationMinutes) !== null ? run.durationMinutes / 60 : null,
        sortTime: (end ?? toDate(run.createdAt))?.getTime() ?? 0,
      };
    });
  }, [runs.data, inventory.data]);

  return {
    rows,
    batches: inventory.data,
    loading: runs.loading || inventory.loading,
    error: runs.error || inventory.error,
  };
}

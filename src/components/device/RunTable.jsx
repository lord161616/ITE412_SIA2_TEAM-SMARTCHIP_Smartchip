import { formatDateTime, formatMinutes, formatTemp } from "../../lib/format";
import StatusBadge from "../ui/StatusBadge";

/** Compact list of drying runs. */
export default function RunTable({ runs }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Batch</th>
            <th>Status</th>
            <th className="num">Target</th>
            <th className="num">Duration</th>
            <th>Created</th>
            <th>Ended</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <strong>{run.batchNumber || (run.source === "imported" ? "Past run" : "Local run")}</strong>
                {run.source === "local" && <div className="muted fine-print">started on the machine</div>}
                {run.source === "imported" && <div className="muted fine-print">added from records</div>}
              </td>
              <td>
                <StatusBadge status={run.status} />
              </td>
              <td className="num">{formatTemp(run.targetTemp, 0)}</td>
              <td className="num">{formatMinutes(run.durationMinutes)}</td>
              <td>{formatDateTime(run.createdAt)}</td>
              <td>{formatDateTime(run.endedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

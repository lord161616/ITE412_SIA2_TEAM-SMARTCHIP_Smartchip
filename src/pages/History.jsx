import { Download, History as HistoryIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, PageHeader } from "../components/ui/Card";
import { EmptyState, Loading, Notice } from "../components/ui/States";
import StatusBadge from "../components/ui/StatusBadge";
import { END_REASONS, RUN, YIELD_THRESHOLDS } from "../config/constants";
import useRunReport from "../hooks/useRunReport";
import { formatDateTime, formatHours, formatKg, formatPercent, formatTemp } from "../lib/format";

const STATUS_FILTERS = [
  ["completed", "Completed"],
  ["stopped", "Stopped / failed"],
  ["all", "All"],
];

/** Thresholds live in config/constants.js (same values as the original app). */
function yieldTone(pct) {
  if (pct >= YIELD_THRESHOLDS.good) return "success";
  if (pct >= YIELD_THRESHOLDS.fair) return "warning";
  return "danger";
}

export default function History() {
  const { rows, loading, error } = useRunReport();
  const [statusFilter, setStatusFilter] = useState("completed");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Filters apply as you type, and keep working when new data arrives.
  const visible = useMemo(() => {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return rows
      .filter((r) => {
        if (statusFilter === "completed" && r.status !== RUN.COMPLETED) return false;
        if (statusFilter === "stopped" && ![RUN.STOPPED, RUN.FAILED].includes(r.status)) return false;
        if (fromMs !== null && r.sortTime < fromMs) return false;
        if (toMs !== null && r.sortTime > toMs) return false;
        return true;
      })
      .sort((a, b) => b.sortTime - a.sortTime);
  }, [rows, statusFilter, from, to]);

  const exportCsv = () => {
    const header = ["Batch", "Status", "Fresh kg", "Dried kg", "Yield %", "Target °C", "Planned h", "Actual h", "Started", "Ended", "End reason"];
    const lines = visible.map((r) => [
      r.batchNumber || r.source || "local",
      r.status,
      r.initial ?? "",
      r.final ?? "",
      r.yieldPct?.toFixed(2) ?? "",
      r.targetTemp ?? "",
      r.plannedHours ?? "",
      r.actualHours?.toFixed(2) ?? "",
      r.start?.toISOString() ?? "",
      r.end?.toISOString() ?? "",
      r.endReason ?? "",
    ]);
    const csv = [header, ...lines]
      .map((cols) => cols.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "smartchip-drying-history.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Drying history"
        description="Every drying run with weights and yield."
        actions={
          <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={!visible.length}>
            <Download size={16} /> Export CSV
          </button>
        }
      />

      <Card>
        <div className="toolbar">
          <div className="segmented" role="tablist">
            {STATUS_FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statusFilter === key}
                className={statusFilter === key ? "is-active" : ""}
                onClick={() => setStatusFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {(from || to) && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Clear dates
            </button>
          )}
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="No runs found">
            {rows.length ? "Nothing matches these filters." : "Completed drying runs will be listed here."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th className="num">Fresh</th>
                  <th className="num">Dried</th>
                  <th className="num">Yield</th>
                  <th className="num">Target</th>
                  <th className="num">Time</th>
                  <th>Started</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.batchNumber || (r.source === "imported" ? "Past run" : "Local run")}</strong>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.endReason && r.endReason !== "completed" && (
                        <div className="muted fine-print">{END_REASONS[r.endReason] ?? r.endReason}</div>
                      )}
                    </td>
                    <td className="num">{formatKg(r.initial)}</td>
                    <td className="num">{r.final !== null ? formatKg(r.final) : r.batchId && r.status === RUN.COMPLETED ? <span className="muted">not weighed</span> : "--"}</td>
                    <td className="num">
                      {r.yieldPct === null ? "--" : <StatusBadge tone={yieldTone(r.yieldPct)} label={formatPercent(r.yieldPct)} />}
                    </td>
                    <td className="num">{formatTemp(r.targetTemp, 0)}</td>
                    <td className="num">{formatHours(r.actualHours ?? r.plannedHours)}</td>
                    <td>{formatDateTime(r.start)}</td>
                    <td>{formatDateTime(r.end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && visible.some((r) => r.status === RUN.COMPLETED && r.final === null) && (
          <p className="fine-print">Record dried weights on the Inventory page (Dried batches → Weigh) to fill in the yield.</p>
        )}
      </Card>
    </div>
  );
}

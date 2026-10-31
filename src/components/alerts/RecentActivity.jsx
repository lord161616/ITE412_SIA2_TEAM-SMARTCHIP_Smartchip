import { CheckCircle2, History, PlayCircle, Square, XCircle } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { END_REASONS, RUN } from "../../config/constants";
import useRunReport from "../../hooks/useRunReport";
import { formatAgo, formatDateTime, formatHours, formatTemp } from "../../lib/format";
import { Card } from "../ui/Card";
import { EmptyState, Loading } from "../ui/States";

const LOOK = {
  started: { icon: PlayCircle, tone: "info" },
  [RUN.COMPLETED]: { icon: CheckCircle2, tone: "success" },
  [RUN.STOPPED]: { icon: Square, tone: "warning" },
  [RUN.FAILED]: { icon: XCircle, tone: "error" },
};

/** Timeline of run starts and endings, newest first, from the drying runs. */
export default function RecentActivity({ limit = 12 }) {
  const { rows, loading } = useRunReport();

  const events = useMemo(() => {
    const list = [];
    rows.forEach((r) => {
      const batch = r.batchNumber ? `Batch ${r.batchNumber}` : "Run from the machine's buttons";
      if (r.start) {
        list.push({
          id: `${r.id}-start`,
          kind: "started",
          time: r.start,
          title: `Drying started · ${batch}`,
          detail: `${formatTemp(r.targetTemp, 0)} for ${formatHours(r.plannedHours)}`,
        });
      }
      if (r.end && LOOK[r.status]) {
        const reason = END_REASONS[r.endReason] ?? r.status;
        list.push({
          id: `${r.id}-end`,
          kind: r.status,
          time: r.end,
          title:
            r.status === RUN.COMPLETED
              ? `Drying complete · ${batch}`
              : r.status === RUN.STOPPED
                ? `Run stopped · ${batch}`
                : `Run failed · ${batch}`,
          detail:
            r.status === RUN.COMPLETED
              ? `${formatHours(r.actualHours)} total${r.final === null ? " · not weighed yet" : ""}`
              : `${reason}${r.faultCode ? ` (${r.faultCode})` : ""}`,
        });
      }
    });
    return list.sort((a, b) => b.time - a.time).slice(0, limit);
  }, [rows, limit]);

  return (
    <Card title="Recent activity" subtitle="Drying runs started and finished" actions={<Link to="/history" className="btn btn-ghost btn-sm">History</Link>}>
      {loading ? (
        <Loading />
      ) : events.length === 0 ? (
        <EmptyState icon={History} title="Nothing yet">
          Run starts and finishes will show up here.
        </EmptyState>
      ) : (
        <ol className="activity-list">
          {events.map((e) => {
            const { icon: Icon, tone } = LOOK[e.kind];
            return (
              <li key={e.id} className={`activity-item tone-${tone}`}>
                <Icon size={18} className="activity-icon" aria-hidden />
                <div className="activity-body">
                  <strong>{e.title}</strong>
                  <span className="muted fine-print">{e.detail}</span>
                </div>
                <time className="muted fine-print" dateTime={e.time.toISOString()} title={formatDateTime(e.time)}>
                  {formatAgo(e.time)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

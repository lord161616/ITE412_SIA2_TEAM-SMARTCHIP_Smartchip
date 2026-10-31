import { CheckCircle2 } from "lucide-react";
import { Notice } from "../ui/States";

const TONE = { error: "error", warning: "warning", info: "info", success: "success" };

export default function AlertList({ alerts, emptyText = "Everything looks normal." }) {
  if (alerts.length === 0) {
    return (
      <div className="all-clear">
        <CheckCircle2 size={18} aria-hidden /> {emptyText}
      </div>
    );
  }
  return (
    <div className="alert-list">
      {alerts.map((a) => (
        <Notice key={a.id} tone={TONE[a.level] ?? "info"} title={a.title}>
          {a.message}
        </Notice>
      ))}
    </div>
  );
}

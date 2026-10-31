import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function Loading({ label = "Loading…", fullPage = false }) {
  return (
    <div className={fullPage ? "loading loading-full" : "loading"} role="status">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-state-icon">
          <Icon size={28} aria-hidden />
        </div>
      )}
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const NOTICE_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

/** Inline message box. tone: info | success | warning | error */
export function Notice({ tone = "info", title, children, action }) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : undefined}>
      <Icon size={18} className="notice-icon" aria-hidden />
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

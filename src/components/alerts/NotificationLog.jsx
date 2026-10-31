import { Inbox, Mail, MessageSquare, MonitorSmartphone, Send } from "lucide-react";
import useLiveData from "../../hooks/useLiveData";
import { formatAgo, formatDateTime, toDate } from "../../lib/format";
import {
  subscribeToNotificationLog,
  subscribeToNotifierStatus,
  subscribeToSmsUsage,
} from "../../services/notificationService";
import { Card } from "../ui/Card";
import { EmptyState, Loading, Notice } from "../ui/States";
import StatusBadge from "../ui/StatusBadge";

/** The notifier checks every minute; it refreshes its heartbeat every ~4 minutes. */
const NOTIFIER_LATE_MS = 10 * 60_000;

const ICONS = { web: MonitorSmartphone, email: Mail, sms: MessageSquare, telegram: Send };

function todayInManila() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

/** What the notifier actually sent, plus today's SMS use and credits left. */
export default function NotificationLog() {
  const log = useLiveData(subscribeToNotificationLog);
  const usage = useLiveData(subscribeToSmsUsage, null);
  const sms = usage.data;
  const usedToday = sms && sms.day === todayInManila() ? sms.count ?? 0 : 0;
  const notifier = useLiveData(subscribeToNotifierStatus, null);
  const lastPoll = toDate(notifier.data?.lastPollAt);
  // eslint-disable-next-line react-hooks/purity -- a rough "is it late?" check on each render is fine
  const late = !lastPoll || Date.now() - lastPoll.getTime() > NOTIFIER_LATE_MS;

  return (
    <Card
      title="Sent notifications"
      subtitle="The last 20 alerts the system sent, and SMS spending"
      actions={
        notifier.loading ? null : (
          <StatusBadge
            tone={late ? "warning" : "success"}
            label={lastPoll ? `Notifier ${late ? "last ran" : "running ·"} ${formatAgo(lastPoll)}` : "Notifier not set up"}
          />
        )
      }
    >
      {!notifier.loading && late && (
        <Notice tone="warning" title={lastPoll ? "The notifier has stopped" : "The notifier isn't set up yet"}>
          Alerts, tests, Connect Telegram and Add staff need the free SmartChip notifier script. See SETUP.md, step 7
          {lastPoll ? ": open it at script.google.com and run setup again." : "."}
        </Notice>
      )}
      <div className="sms-usage">
        <div>
          <span className="muted fine-print">SMS today</span>
          <strong>
            {usedToday}
            {sms?.limit !== undefined && <span className="muted"> / {sms.limit}</span>}
          </strong>
          <span className="muted fine-print">≈ ₱{(usedToday * 0.63).toFixed(2)}</span>
        </div>
        <div>
          <span className="muted fine-print">Semaphore credits</span>
          <strong className={sms?.credits !== undefined && sms.credits < 20 ? "text-warning" : ""}>
            {sms?.credits ?? "--"}
          </strong>
          <span className="muted fine-print">
            {sms?.creditsCheckedAt ? `checked ${formatAgo(sms.creditsCheckedAt)}` : "checked after each SMS"}
          </span>
        </div>
      </div>

      {log.error && <Notice tone="error">{log.error}</Notice>}
      {log.loading ? (
        <Loading />
      ) : log.data.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing sent yet">
          Alerts will be listed here once the notification functions are deployed.
        </EmptyState>
      ) : (
        <ol className="activity-list">
          {log.data.map((entry) => {
            const time = toDate(entry.createdAt);
            return (
              <li key={entry.id} className="activity-item log-item">
                <div className="activity-body">
                  <strong>
                    {entry.title}
                    {entry.test && <span className="muted fine-print"> · test</span>}
                  </strong>
                  <span className="log-channels">
                    {Object.entries(entry.results ?? {}).map(([ch, r]) => {
                      const Icon = ICONS[ch] ?? Inbox;
                      return (
                        <span key={ch} className={`log-chip ${r.sent ? "" : "is-off"}`} title={r.note || undefined}>
                          <Icon size={13} aria-hidden /> {ch} {r.sent ?? 0}
                          {r.capped ? ` (+${r.capped} over limit)` : ""}
                        </span>
                      );
                    })}
                  </span>
                  {Object.entries(entry.results ?? {})
                    .filter(([, r]) => r.note)
                    .map(([ch, r]) => (
                      <span key={ch} className="muted fine-print">
                        {ch}: {r.note}
                      </span>
                    ))}
                  {entry.errors?.map((e) => (
                    <span key={e} className="fine-print text-danger">
                      {e}
                    </span>
                  ))}
                </div>
                <time className="muted fine-print" title={time ? formatDateTime(time) : undefined}>
                  {time ? formatAgo(time) : "…"}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

import MyNotifications from "../components/alerts/MyNotifications";
import NotificationLog from "../components/alerts/NotificationLog";
import NotificationSettings from "../components/alerts/NotificationSettings";
import RecentActivity from "../components/alerts/RecentActivity";
import ThisDevice from "../components/alerts/ThisDevice";
import AlertList from "../components/device/AlertList";
import DeviceBanner from "../components/device/DeviceBanner";
import { Card, PageHeader } from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import { TEMP_LIMITS } from "../config/constants";
import { useDevice } from "../context/DeviceContext";
import useAlerts from "../hooks/useAlerts";

const WATCHED = [
  ["Machine faults", "Sensor failures, the 80 °C cut-off, preheat timeout"],
  ["Temperature", `Warns 5 °C above target (in the app); fault at the ${TEMP_LIMITS.hardSafety} °C cut-off`],
  ["Offline", "No update for 45 s shows here; 3+ minutes during a run sends a notification"],
  ["Runs", "Started, complete (reminder to weigh), stopped or interrupted"],
  ["Commands", "START / STOP not picked up within 20 seconds, or rejected (in the app)"],
  ["Shop", "New orders with their GCash reference (operators and admins)"],
];

export default function Notifications() {
  const alerts = useAlerts();
  const { online } = useDevice();
  const counts = {
    error: alerts.filter((a) => a.level === "error").length,
    warning: alerts.filter((a) => a.level === "warning").length,
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Overview"
        title="Alerts"
        description="Live problems, recent activity, and who gets notified by web, email, SMS or Telegram."
      />

      <DeviceBanner />

      <div className="two-col">
        <div className="stack">
          <Card
            title="Active alerts"
            actions={
              <>
                {counts.error > 0 && <StatusBadge tone="danger" label={`${counts.error} critical`} />}
                {counts.warning > 0 && <StatusBadge tone="warning" label={`${counts.warning} warning`} />}
              </>
            }
          >
            <AlertList alerts={alerts} emptyText={online ? "No active alerts. Everything looks normal." : "No alerts."} />
          </Card>
          <RecentActivity limit={8} />
          <NotificationLog />
        </div>

        <div className="stack">
          <MyNotifications />
          <ThisDevice />
          <Card title="What SmartChip watches">
            <ul className="watch-list">
              {WATCHED.map(([title, text]) => (
                <li key={title}>
                  <strong>{title}</strong>
                  <span className="muted">{text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <NotificationSettings />
    </div>
  );
}

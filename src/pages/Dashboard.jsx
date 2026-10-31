import { Link } from "react-router-dom";
import AlertList from "../components/device/AlertList";
import DeviceBanner from "../components/device/DeviceBanner";
import LiveTrendCard from "../components/device/LiveTrendCard";
import MachinePanel from "../components/device/MachinePanel";
import { ChamberStats } from "../components/device/SensorReadings";
import { Card, PageHeader } from "../components/ui/Card";
import useAlerts from "../hooks/useAlerts";

export default function Dashboard() {
  const alerts = useAlerts();

  return (
    <div className="page">
      <PageHeader
        eyebrow="SmartChip monitoring"
        title="Dehydrator dashboard"
        description="Live status of the mushroom drying chamber."
      />

      <DeviceBanner />
      <ChamberStats />

      <div className="two-col">
        <LiveTrendCard height={300} />
        <div className="stack">
          <MachinePanel />
          <Card
            title="Alerts"
            actions={
              <Link to="/notifications" className="btn btn-ghost btn-sm">
                View all
              </Link>
            }
          >
            <AlertList alerts={alerts.slice(0, 3)} />
          </Card>
        </div>
      </div>
    </div>
  );
}

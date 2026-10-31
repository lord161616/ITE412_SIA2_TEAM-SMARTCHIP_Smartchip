import { History as HistoryIcon } from "lucide-react";
import { Link } from "react-router-dom";
import DeviceBanner from "../components/device/DeviceBanner";
import MachinePanel from "../components/device/MachinePanel";
import RunTable from "../components/device/RunTable";
import StartRunForm from "../components/device/StartRunForm";
import { Card, PageHeader } from "../components/ui/Card";
import { EmptyState, Loading, Notice } from "../components/ui/States";
import useLiveData from "../hooks/useLiveData";
import { subscribeToRuns } from "../services/dryingService";

export default function Scheduler() {
  const { data: runs, loading, error } = useLiveData(subscribeToRuns);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Drying control"
        description="Start a batch, watch its progress, and stop or recover the machine."
      />

      <DeviceBanner />
      <MachinePanel idleContent={<StartRunForm />} />

      <Card
        title="Recent runs"
        actions={
          <Link to="/history" className="btn btn-ghost btn-sm">
            Full history
          </Link>
        }
      >
        {error && <Notice tone="error">{error}</Notice>}
        {loading ? (
          <Loading />
        ) : runs.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="No drying runs yet">
            Runs you start appear here.
          </EmptyState>
        ) : (
          <RunTable runs={runs.slice(0, 10)} />
        )}
      </Card>
    </div>
  );
}

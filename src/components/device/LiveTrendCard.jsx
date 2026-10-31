import { LineChart } from "lucide-react";
import { useDevice } from "../../context/DeviceContext";
import { toNumber } from "../../lib/format";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/States";
import TrendChart from "./TrendChart";

/**
 * Chart of readings received since this browser tab connected. The ESP32
 * doesn't store history in Firestore yet, so this is the honest live view.
 */
export default function LiveTrendCard({ height }) {
  const { history, activeRun, online, clearHistory } = useDevice();
  const target = toNumber(activeRun?.targetTemp);

  return (
    <Card
      title="Live trend"
      subtitle="Chamber readings received since you opened SmartChip in this tab"
      actions={
        history.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearHistory}>
            Clear
          </button>
        )
      }
    >
      {history.length < 2 ? (
        <EmptyState icon={LineChart} title={online ? "Collecting readings…" : "Waiting for the device"}>
          {online
            ? "The chart fills in as each heartbeat arrives from the ESP32."
            : "The trend starts as soon as the ESP32 sends live readings."}
        </EmptyState>
      ) : (
        <TrendChart points={history} height={height} targetTemp={target} />
      )}
    </Card>
  );
}

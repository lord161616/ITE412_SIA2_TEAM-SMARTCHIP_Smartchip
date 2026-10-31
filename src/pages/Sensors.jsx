import DeviceBanner from "../components/device/DeviceBanner";
import LiveTrendCard from "../components/device/LiveTrendCard";
import { ChamberStats, SensorCards } from "../components/device/SensorReadings";
import { Card, InfoGrid, PageHeader } from "../components/ui/Card";
import { useDevice } from "../context/DeviceContext";
import { formatAgo, formatHumidity, formatTemp, toNumber } from "../lib/format";

export default function Sensors() {
  const { device, history, online, now } = useDevice();

  const temps = history.map((h) => toNumber(h.temperature)).filter((v) => v !== null);
  const hums = history.map((h) => toNumber(h.humidity)).filter((v) => v !== null);
  const range = (list, fmt) => (list.length ? `${fmt(Math.min(...list))} – ${fmt(Math.max(...list))}` : "--");

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Sensors"
        description="SHT31 temperature / humidity readings and heater status."
      />

      <DeviceBanner />
      <ChamberStats />

      <div className="two-col">
        <LiveTrendCard height={320} />
        <div className="stack">
          <Card title="SHT31 sensors">
            <SensorCards />
          </Card>
          <Card title="This session" subtitle="Since you opened SmartChip in this tab">
            <InfoGrid
              items={[
                { label: "Readings", value: history.length },
                { label: "Last reading", value: online ? formatAgo(device?.lastSeen, now) : "--" },
                { label: "Temperature range", value: range(temps, (v) => formatTemp(v)) },
                { label: "Humidity range", value: range(hums, (v) => formatHumidity(v)) },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

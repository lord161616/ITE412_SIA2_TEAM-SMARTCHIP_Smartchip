import { Droplets, Fan, Flame, Thermometer } from "lucide-react";
import { useDevice } from "../../context/DeviceContext";
import { formatHumidity, formatTemp } from "../../lib/format";
import { StatCard } from "../ui/Card";
import StatusBadge from "../ui/StatusBadge";

/** Chamber average + heater/fan tiles. */
export function ChamberStats() {
  const { online, device } = useDevice();
  const show = online && device;
  const target = device?.runId ? device.targetTemp : null;

  return (
    <div className="stat-grid">
      <StatCard
        icon={Thermometer}
        label="Temperature"
        value={show ? formatTemp(device.temperature) : "--"}
        hint={target ? `Target ${formatTemp(target, 0)}` : "Average of both SHT31s"}
        tone="orange"
      />
      <StatCard
        icon={Droplets}
        label="Humidity"
        value={show ? formatHumidity(device.humidity) : "--"}
        hint="Relative humidity"
        tone="blue"
      />
      <StatCard
        icon={Flame}
        label="Heater"
        value={show ? (device.heaterOn ? "ON" : "OFF") : "--"}
        hint="Switched by the SSR"
        tone={show && device.heaterOn ? "warning" : "neutral"}
      />
      <StatCard
        icon={Fan}
        label="Fan"
        value={show ? (device.heaterOn ? "ON" : "OFF") : "--"}
        hint="Same SSR as the heater"
        tone={show && device.heaterOn ? "primary" : "neutral"}
      />
    </div>
  );
}

/** The two SHT31 sensors. */
export function SensorCards() {
  const { online, device } = useDevice();

  if (!device) return <p className="muted">Waiting for the ESP32.</p>;

  return (
    <div className="sensor-grid">
      {device.sensors.map((s) => (
        <div key={s.key} className="sensor-card">
          <div className="sensor-card-top">
            <div>
              <div className="sensor-name">{s.label}</div>
              <div className="muted fine-print">{s.location}</div>
            </div>
            <StatusBadge
              status={online && s.ok ? "online" : "offline"}
              label={!online ? "Offline" : s.ok ? "OK" : "No reading"}
              dot
            />
          </div>
          <div className="sensor-values">
            <div>
              <span className="muted">
                <Thermometer size={14} /> Temp
              </span>
              <strong>{online ? formatTemp(s.temperature) : "--"}</strong>
            </div>
            <div>
              <span className="muted">
                <Droplets size={14} /> Humidity
              </span>
              <strong>{online ? formatHumidity(s.humidity) : "--"}</strong>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

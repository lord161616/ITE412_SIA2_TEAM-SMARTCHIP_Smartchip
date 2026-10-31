import { Cpu, Wifi, WifiOff } from "lucide-react";
import { CONNECTION, DEVICE_ID } from "../../config/constants";
import { useDevice } from "../../context/DeviceContext";
import { formatAgo } from "../../lib/format";
import StatusBadge from "../ui/StatusBadge";

const COPY = {
  [CONNECTION.LOADING]: ["Connecting…", "Reading the device status from Firestore."],
  [CONNECTION.MISSING]: [
    "Device not set up",
    `There is no devices/${DEVICE_ID} document yet. The ESP32 creates it the first time it connects (see SETUP.md).`,
  ],
  [CONNECTION.OFFLINE]: ["Device offline", "No heartbeat from the ESP32 for over 45 seconds."],
  [CONNECTION.ONLINE]: ["Device online", "Receiving live data from the dehydrator."],
  [CONNECTION.ERROR]: ["Can't read device", ""],
};

/** The status strip at the top of the monitoring pages. */
export default function DeviceBanner() {
  const { connection, device, error, now } = useDevice();
  const [title, description] = COPY[connection];
  const Icon = connection === CONNECTION.ONLINE ? Wifi : WifiOff;

  return (
    <section className={`device-banner is-${connection}`}>
      <div className="device-banner-main">
        <span className="device-banner-icon">
          <Icon size={22} aria-hidden />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{error || description}</p>
        </div>
      </div>
      <dl className="device-banner-facts">
        <div>
          <dt>
            <Cpu size={13} aria-hidden /> Device
          </dt>
          <dd>{device?.deviceId ?? DEVICE_ID}</dd>
        </div>
        <div>
          <dt>Machine</dt>
          <dd>{device?.status ? <StatusBadge status={device.status} /> : "--"}</dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd>{formatAgo(device?.lastSeen, now)}</dd>
        </div>
      </dl>
    </section>
  );
}

import { CONNECTION, MACHINE, RUN } from "../../config/constants";
import { titleCase } from "../../lib/format";

/** Maps every status word in the app to one colour, so they match everywhere. */
const TONES = {
  // connection
  [CONNECTION.ONLINE]: "success",
  [CONNECTION.OFFLINE]: "danger",
  [CONNECTION.MISSING]: "muted",
  [CONNECTION.LOADING]: "muted",
  [CONNECTION.ERROR]: "danger",
  // machine
  [MACHINE.IDLE]: "neutral",
  [MACHINE.SETUP]: "info",
  [MACHINE.PREHEATING]: "warning",
  [MACHINE.DRYING]: "primary",
  [MACHINE.COMPLETED]: "success",
  [MACHINE.FAULT]: "danger",
  // runs
  [RUN.PENDING]: "info",
  [RUN.STOPPED]: "neutral",
  [RUN.FAILED]: "danger",
  // inventory
  fresh: "info",
  dried: "success",
  archived: "muted",
  // users
  active: "success",
  inactive: "danger",
  pending: "warning",
  // hardware
  on: "warning",
  off: "neutral",
};

const LABELS = {
  [CONNECTION.MISSING]: "Not set up",
  [CONNECTION.LOADING]: "Checking…",
  [CONNECTION.ERROR]: "Error",
};

/** `tone` overrides the colour: success | warning | danger | info | primary | muted | neutral */
export default function StatusBadge({ status, label, tone: toneOverride, dot = false }) {
  const key = String(status ?? "").toLowerCase();
  const tone = toneOverride ?? TONES[key] ?? "neutral";
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" aria-hidden />}
      {label ?? LABELS[key] ?? titleCase(key || "unknown")}
    </span>
  );
}

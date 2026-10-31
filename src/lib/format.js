/** Small, shared formatting helpers. Every page uses these instead of its own copy. */

/** Number or null (never NaN). */
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Firestore Timestamp | Date | string | number -> Date or null. */
export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  // "2026-10-27" (from <input type="date">) means local midnight, not UTC.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTemp(value, digits = 1) {
  const n = toNumber(value);
  return n === null ? "--" : `${n.toFixed(digits)} °C`;
}

export function formatHumidity(value, digits = 1) {
  const n = toNumber(value);
  return n === null ? "--" : `${n.toFixed(digits)} %`;
}

export function formatKg(value) {
  const n = toNumber(value);
  return n === null ? "--" : `${n.toFixed(2)} kg`;
}

export function formatNumber(value, digits = 2) {
  const n = toNumber(value);
  return n === null ? "--" : n.toFixed(digits);
}

export function formatPercent(value, digits = 1) {
  const n = toNumber(value);
  return n === null ? "--" : `${n.toFixed(digits)} %`;
}

/** 3725 -> "01:02:05" */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(toNumber(totalSeconds) ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [h, m, s % 60].map((v) => String(v).padStart(2, "0")).join(":");
}

/** 5.5 -> "5 h 30 m" */
export function formatHours(hours) {
  const n = toNumber(hours);
  if (n === null) return "--";
  const totalMinutes = Math.round(n * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** 90 -> "1 h 30 m" */
export function formatMinutes(minutes) {
  const n = toNumber(minutes);
  return n === null ? "--" : formatHours(n / 60);
}

export function formatDateTime(value) {
  const date = toDate(value);
  return date
    ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "--";
}

export function formatDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString([], { dateStyle: "medium" }) : "--";
}

export function formatTime(value) {
  const date = toDate(value);
  return date
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--";
}

/** "12s ago", "3m ago", or a date for older values. */
export function formatAgo(value, now = Date.now()) {
  const date = toDate(value);
  if (!date) return "Never";
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDateTime(date);
}

/** "drying" -> "Drying" */
export function titleCase(value) {
  if (!value || typeof value !== "string") return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Mean of the finite numbers in a list, or null. */
export function average(values) {
  const nums = values.map(toNumber).filter((v) => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

/** 1234.5 -> "₱1,234.50" */
export function formatPeso(value) {
  const n = toNumber(value);
  return n === null
    ? "--"
    : `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 250 -> "250 g", 1500 -> "1.5 kg" */
export function formatGrams(value) {
  const n = toNumber(value);
  if (n === null) return "--";
  if (Math.abs(n) >= 1000) return `${Number((n / 1000).toFixed(2))} kg`;
  return `${Math.round(n)} g`;
}

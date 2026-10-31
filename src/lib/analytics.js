/**
 * Helpers for the Analytics page: date ranges, time buckets and the chart
 * colour palette. Kept free of React so they're easy to test.
 */

/**
 * Categorical colours, assigned in this fixed order (never cycled).
 * Checked for colour-blind separation against the white card surface.
 */
export const SERIES = ["#4053d6", "#e8590c", "#0ca678", "#c2255c", "#1c7ed6"];

/** Status colours: only for good / warning / bad states, always with a label. */
export const STATUS_COLORS = {
  good: "#15803d",
  warning: "#d97706",
  bad: "#dc2626",
  neutral: "#cbd5e1",
};

export const CHART_TEXT = "#64748b";
export const CHART_GRID = "rgba(15, 23, 42, 0.06)";

export const RANGES = [
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "12m", label: "12 months", days: 365 },
  { id: "all", label: "All time", days: null },
];

const DAY = 86_400_000;

/** Start of the selected range (ms), or the earliest item's time for "All time". */
export function rangeStart(rangeId, times, now = Date.now()) {
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[3];
  if (range.days) return now - range.days * DAY;
  const valid = times.filter((t) => t > 0);
  return valid.length ? Math.min(...valid) : now - 30 * DAY;
}

/** day / week / month, picked so the chart has a sensible number of bars. */
export function bucketUnit(start, now = Date.now()) {
  const span = (now - start) / DAY;
  if (span <= 31) return "day";
  if (span <= 120) return "week";
  return "month";
}

function floorTo(unit, ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (unit === "month") d.setDate(1);
  return d;
}

function step(unit, date) {
  const d = new Date(date);
  if (unit === "day") d.setDate(d.getDate() + 1);
  if (unit === "week") d.setDate(d.getDate() + 7);
  if (unit === "month") d.setMonth(d.getMonth() + 1);
  return d;
}

function labelFor(unit, date) {
  if (unit === "month") return date.toLocaleDateString([], { month: "short", year: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Continuous buckets from start to now (empty periods included, so gaps show).
 * Returns { labels, keyOf(ms) -> index | -1, size }.
 */
export function makeBuckets(start, now = Date.now()) {
  const unit = bucketUnit(start, now);
  const starts = [];
  for (let d = floorTo(unit, start); d.getTime() <= now; d = step(unit, d)) starts.push(d.getTime());
  if (starts.length === 0) starts.push(floorTo(unit, now).getTime());
  const labels = starts.map((t) => (unit === "week" ? `Wk of ${labelFor(unit, new Date(t))}` : labelFor(unit, new Date(t))));
  return {
    unit,
    labels,
    size: starts.length,
    indexOf(ms) {
      if (!ms || ms < starts[0]) return -1;
      let i = starts.length - 1;
      while (i > 0 && starts[i] > ms) i -= 1;
      return i;
    },
  };
}

/** Group a list into a Map by key function. */
export function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export const sum = (list, fn) => list.reduce((total, item) => total + (Number(fn(item)) || 0), 0);

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekdayIndex = (date) => (date.getDay() + 6) % 7;

/** Shared Chart.js scale styling. */
export function axis(extra = {}) {
  return {
    grid: { color: CHART_GRID, drawTicks: false },
    border: { display: false },
    ticks: { color: CHART_TEXT, padding: 6 },
    ...extra,
    title: extra.title ? { display: true, color: CHART_TEXT, ...extra.title } : undefined,
  };
}

export function categoryAxis(extra = {}) {
  return {
    grid: { display: false },
    border: { color: "#e2e8f0" },
    ticks: { color: CHART_TEXT, maxRotation: 0, autoSkipPadding: 12 },
    ...extra,
  };
}

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
} from "chart.js";
import { useEffect, useRef } from "react";
import { CHART_TEXT } from "../../lib/analytics";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

const BASE_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 250 },
  plugins: {
    legend: {
      position: "top",
      align: "end",
      labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, color: CHART_TEXT },
    },
    tooltip: {
      backgroundColor: "#0f172a",
      padding: 10,
      cornerRadius: 8,
      boxPadding: 4,
      titleFont: { weight: "600" },
    },
  },
};

function merge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) && typeof value !== "function" && base[key]
        ? merge(base[key], value)
        : value;
  }
  return out;
}

/**
 * One Chart.js chart. Pass a memoised `type`, `data` and `options`;
 * the chart is rebuilt when they change.
 */
export default function ChartCanvas({ type, data, options, height = 260, label }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const showLegend = data.datasets.length > 1;
    const chart = new Chart(canvasRef.current, {
      type,
      data,
      options: merge(merge(BASE_OPTIONS, { plugins: { legend: { display: showLegend } } }), options),
    });
    return () => chart.destroy();
  }, [type, data, options]);

  return (
    <div className="chart-box" style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={label} />
    </div>
  );
}

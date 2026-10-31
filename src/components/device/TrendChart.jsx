import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { useEffect, useRef } from "react";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

const COLORS = {
  temperature: "#e8590c",
  humidity: "#1c7ed6",
  grid: "rgba(15, 23, 42, 0.06)",
  text: "#64748b",
};

const timeLabel = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Temperature + humidity line chart.
 * points: [{ time: ms, temperature, humidity }]
 * The chart is created once and updated in place (no flicker on new readings).
 */
export default function TrendChart({ points, height = 280, targetTemp = null }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const chart = new Chart(canvasRef.current, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { boxWidth: 12, color: COLORS.text } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.formattedValue}` } },
        },
        elements: { point: { radius: 0, hoverRadius: 4 }, line: { tension: 0.3, borderWidth: 2 } },
        scales: {
          x: { grid: { display: false }, ticks: { color: COLORS.text, maxTicksLimit: 8, maxRotation: 0 } },
          temperature: {
            type: "linear",
            position: "left",
            title: { display: true, text: "°C", color: COLORS.text },
            grid: { color: COLORS.grid },
            ticks: { color: COLORS.text },
          },
          humidity: {
            type: "linear",
            position: "right",
            min: 0,
            max: 100,
            title: { display: true, text: "% RH", color: COLORS.text },
            grid: { drawOnChartArea: false },
            ticks: { color: COLORS.text },
          },
        },
      },
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = points.map((p) => timeLabel(p.time));
    chart.data.datasets = [
      {
        label: "Temperature (°C)",
        data: points.map((p) => p.temperature),
        borderColor: COLORS.temperature,
        backgroundColor: "rgba(232, 89, 12, 0.08)",
        fill: true,
        yAxisID: "temperature",
        spanGaps: true,
      },
      {
        label: "Humidity (%)",
        data: points.map((p) => p.humidity),
        borderColor: COLORS.humidity,
        backgroundColor: "transparent",
        yAxisID: "humidity",
        spanGaps: true,
      },
      ...(targetTemp !== null
        ? [
            {
              label: "Target",
              data: points.map(() => targetTemp),
              borderColor: "rgba(232, 89, 12, 0.5)",
              borderDash: [6, 4],
              borderWidth: 1.5,
              yAxisID: "temperature",
              fill: false,
            },
          ]
        : []),
    ];
    chart.update("none");
  }, [points, targetTemp]);

  return (
    <div className="chart-box" style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label="Temperature and humidity trend" />
    </div>
  );
}

import { Activity, BarChart3, CheckCircle2, Clock, Leaf, Scale, Thermometer, Timer } from "lucide-react";
import { useMemo } from "react";
import { BATCH, END_REASONS, RUN, YIELD_THRESHOLDS } from "../../config/constants";
import {
  axis,
  categoryAxis,
  groupBy,
  makeBuckets,
  SERIES,
  STATUS_COLORS,
  sum,
} from "../../lib/analytics";
import { average, formatHours, formatKg, formatPercent, formatTemp } from "../../lib/format";
import { Card, StatCard } from "../ui/Card";
import { EmptyState } from "../ui/States";
import ChartCanvas from "./ChartCanvas";

const bar = { borderRadius: 4, borderSkipped: "start", maxBarThickness: 36 };
const stackedBar = { ...bar, borderSkipped: false, borderColor: "#ffffff", borderWidth: { top: 2 } };

function yieldTier(pct) {
  if (pct >= YIELD_THRESHOLDS.good) return { color: STATUS_COLORS.good, label: "Good" };
  if (pct >= YIELD_THRESHOLDS.fair) return { color: STATUS_COLORS.warning, label: "Fair" };
  return { color: STATUS_COLORS.bad, label: "Low" };
}

export default function DryingAnalytics({ rows, batches, start }) {
  const s = useMemo(() => {
    const inRange = rows.filter((r) => r.sortTime >= start);
    const completed = inRange.filter((r) => r.status === RUN.COMPLETED);
    const finished = inRange.filter((r) => [RUN.COMPLETED, RUN.STOPPED, RUN.FAILED].includes(r.status));
    const weighed = completed.filter((r) => r.yieldPct !== null);
    const hoursOf = (r) => r.actualHours ?? r.plannedHours;
    return {
      inRange,
      completed,
      finished,
      weighed,
      successRate: finished.length ? (completed.length / finished.length) * 100 : null,
      totalHours: sum(completed, hoursOf),
      freshKg: sum(completed, (r) => r.initial),
      driedKg: sum(weighed, (r) => r.final),
      avgYield: average(weighed.map((r) => r.yieldPct)),
      avgTarget: average(completed.map((r) => r.targetTemp)),
      avgHours: average(completed.map(hoursOf)),
      kgPerHour: sum(completed, hoursOf) > 0 ? sum(completed, (r) => r.initial) / sum(completed, hoursOf) : null,
    };
  }, [rows, start]);

  /* Runs per period, by outcome */
  const runsOverTime = useMemo(() => {
    const b = makeBuckets(start);
    const series = [
      { status: RUN.COMPLETED, label: "Completed", color: STATUS_COLORS.good },
      { status: RUN.STOPPED, label: "Stopped", color: STATUS_COLORS.warning },
      { status: RUN.FAILED, label: "Failed", color: STATUS_COLORS.bad },
    ];
    return {
      labels: b.labels,
      datasets: series.map(({ status, label, color }) => {
        const data = new Array(b.size).fill(0);
        s.finished.filter((r) => r.status === status).forEach((r) => {
          const i = b.indexOf(r.sortTime);
          if (i >= 0) data[i] += 1;
        });
        return { label, data, backgroundColor: color, ...stackedBar };
      }),
    };
  }, [s.finished, start]);

  /* Fresh in vs dried out, per period */
  const weightOverTime = useMemo(() => {
    const b = makeBuckets(start);
    const fresh = new Array(b.size).fill(0);
    const dried = new Array(b.size).fill(0);
    s.completed.forEach((r) => {
      const i = b.indexOf(r.sortTime);
      if (i < 0) return;
      fresh[i] += r.initial ?? 0;
      dried[i] += r.final ?? 0;
    });
    const round = (v) => Math.round(v * 100) / 100;
    return {
      labels: b.labels,
      datasets: [
        { label: "Fresh in", data: fresh.map(round), backgroundColor: SERIES[0], ...bar },
        { label: "Dried out", data: dried.map(round), backgroundColor: SERIES[1], ...bar },
      ],
    };
  }, [s.completed, start]);

  /* Yield per batch (latest 15), coloured by tier */
  const recentYield = useMemo(() => [...s.weighed].sort((a, b) => a.sortTime - b.sortTime).slice(-15), [s.weighed]);
  const yieldData = useMemo(
    () => ({
      labels: recentYield.map((r) => r.batchNumber ?? "—"),
      datasets: [
        {
          label: "Yield",
          data: recentYield.map((r) => Number(r.yieldPct.toFixed(1))),
          backgroundColor: recentYield.map((r) => yieldTier(r.yieldPct).color),
          ...bar,
        },
      ],
    }),
    [recentYield],
  );
  const yieldOptions = useMemo(
    () => ({
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.formattedValue} % yield (${yieldTier(ctx.raw).label})`,
            afterLabel: (ctx) => {
              const r = recentYield[ctx.dataIndex];
              return ` ${formatKg(r.initial)} → ${formatKg(r.final)} at ${formatTemp(r.targetTemp, 0)}`;
            },
          },
        },
      },
      scales: { x: categoryAxis(), y: axis({ beginAtZero: true, title: { text: "Yield %" } }) },
    }),
    [recentYield],
  );

  /* Average yield by target temperature band */
  const tempBands = useMemo(() => {
    const groups = groupBy(
      s.weighed.filter((r) => Number.isFinite(Number(r.targetTemp))),
      (r) => Math.floor(Number(r.targetTemp) / 5) * 5,
    );
    const keys = [...groups.keys()].sort((a, b) => a - b);
    return keys.map((k) => ({
      label: `${k}–${k + 4} °C`,
      avg: average(groups.get(k).map((r) => r.yieldPct)),
      hours: average(groups.get(k).map((r) => r.actualHours ?? r.plannedHours)),
      count: groups.get(k).length,
    }));
  }, [s.weighed]);
  const tempData = useMemo(
    () => ({
      labels: tempBands.map((b) => b.label),
      datasets: [
        { label: "Average yield", data: tempBands.map((b) => Number(b.avg.toFixed(1))), backgroundColor: SERIES[0], ...bar },
      ],
    }),
    [tempBands],
  );
  const tempOptions = useMemo(
    () => ({
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.formattedValue} % average yield`,
            afterLabel: (ctx) => {
              const b = tempBands[ctx.dataIndex];
              return ` ${b.count} batch${b.count === 1 ? "" : "es"} · avg ${formatHours(b.hours)}`;
            },
          },
        },
      },
      scales: { x: categoryAxis(), y: axis({ beginAtZero: true, title: { text: "Yield %" } }) },
    }),
    [tempBands],
  );

  /* Planned vs actual time, latest 12 completed */
  const recentTimed = useMemo(
    () =>
      [...s.completed]
        .filter((r) => r.actualHours !== null && r.plannedHours !== null)
        .sort((a, b) => a.sortTime - b.sortTime)
        .slice(-12),
    [s.completed],
  );
  const timeData = useMemo(
    () => ({
      labels: recentTimed.map((r) => r.batchNumber ?? "—"),
      datasets: [
        { label: "Planned", data: recentTimed.map((r) => +r.plannedHours.toFixed(2)), backgroundColor: SERIES[0], ...bar },
        { label: "Actual", data: recentTimed.map((r) => +r.actualHours.toFixed(2)), backgroundColor: SERIES[1], ...bar },
      ],
    }),
    [recentTimed],
  );

  /* How runs ended */
  const endReasons = useMemo(() => {
    const groups = groupBy(s.finished, (r) => r.endReason || (r.status === RUN.COMPLETED ? "completed" : "unknown"));
    const list = [...groups.entries()]
      .map(([key, items]) => ({ label: END_REASONS[key] ?? "Not recorded", count: items.length, key }))
      .sort((a, b) => b.count - a.count);
    return {
      labels: list.map((x) => x.label),
      datasets: [
        {
          label: "Runs",
          data: list.map((x) => x.count),
          backgroundColor: list.map((x) => (x.key === "completed" ? STATUS_COLORS.good : SERIES[0])),
          ...bar,
          borderSkipped: "start",
        },
      ],
    };
  }, [s.finished]);

  /* Inventory now */
  const inventory = useMemo(() => {
    const order = [BATCH.FRESH, BATCH.DRYING, BATCH.DRIED, BATCH.ARCHIVED];
    const groups = groupBy(batches, (b) => b.status);
    const rowsOut = order.map((status) => {
      const items = groups.get(status) ?? [];
      return {
        status,
        count: items.length,
        kg: status === BATCH.DRIED || status === BATCH.ARCHIVED ? sum(items, (b) => b.driedWeight) : sum(items, (b) => b.freshWeight),
      };
    });
    return rowsOut;
  }, [batches]);
  const inventoryData = useMemo(
    () => ({
      labels: inventory.map((x) => x.status),
      datasets: [
        {
          label: "Batches",
          data: inventory.map((x) => x.count),
          backgroundColor: [SERIES[0], SERIES[1], SERIES[2], STATUS_COLORS.neutral],
          ...bar,
        },
      ],
    }),
    [inventory],
  );
  const inventoryOptions = useMemo(
    () => ({
      indexAxis: "y",
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.formattedValue} batch(es)`,
            afterLabel: (ctx) => {
              const x = inventory[ctx.dataIndex];
              const kind = x.status === BATCH.DRIED || x.status === BATCH.ARCHIVED ? "dried" : "fresh";
              return ` ${formatKg(x.kg)} ${kind}`;
            },
          },
        },
      },
      scales: { y: categoryAxis(), x: axis({ beginAtZero: true, ticks: { precision: 0, color: "#64748b" } }) },
    }),
    [inventory],
  );

  const hasRuns = s.inRange.length > 0;

  return (
    <>
      <div className="stat-grid">
        <StatCard icon={CheckCircle2} label="Completed runs" value={s.completed.length} hint={`${s.inRange.length} runs in range`} tone="success" />
        <StatCard icon={Activity} label="Success rate" value={formatPercent(s.successRate, 0)} hint={`${s.finished.length} finished runs`} tone="success" />
        <StatCard icon={Scale} label="Average yield" value={formatPercent(s.avgYield)} hint={`${s.weighed.length} weighed batches`} tone="orange" />
        <StatCard icon={Leaf} label="Dried out" value={formatKg(s.driedKg)} hint={`from ${formatKg(s.freshKg)} fresh`} tone="orange" />
        <StatCard icon={Clock} label="Drying time" value={formatHours(s.totalHours)} hint="Across completed runs" tone="primary" />
        <StatCard icon={Timer} label="Avg. run length" value={formatHours(s.avgHours)} hint="Completed runs" tone="primary" />
        <StatCard icon={Thermometer} label="Average target" value={formatTemp(s.avgTarget, 1)} hint="Completed runs" tone="blue" />
        <StatCard icon={BarChart3} label="Throughput" value={s.kgPerHour === null ? "--" : `${s.kgPerHour.toFixed(2)} kg/h`} hint="Fresh kg per drying hour" tone="blue" />
      </div>

      {!hasRuns ? (
        <Card>
          <EmptyState icon={BarChart3} title="No drying runs in this range">
            Pick a longer range, or complete a drying run to see charts here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="two-col-even">
            <Card title="Runs over time" subtitle="Finished runs per period, by outcome">
              <ChartCanvas
                type="bar"
                data={runsOverTime}
                options={STACKED_COUNT_OPTIONS}
                label="Finished drying runs per period, stacked by outcome"
              />
            </Card>
            <Card title="Weight processed" subtitle="Fresh weight in vs dried weight out (kg)">
              <ChartCanvas type="bar" data={weightOverTime} options={KG_OPTIONS} label="Fresh and dried kilograms per period" />
            </Card>
          </div>

          <div className="two-col-even">
            <Card
              title="Yield per batch"
              subtitle={`Latest 15 weighed batches · green ≥ ${YIELD_THRESHOLDS.good} %, amber ≥ ${YIELD_THRESHOLDS.fair} %, red below`}
            >
              {recentYield.length === 0 ? (
                <EmptyState icon={Scale} title="No weighed batches yet">
                  Record dried weights in Inventory to see yield here.
                </EmptyState>
              ) : (
                <ChartCanvas type="bar" data={yieldData} options={yieldOptions} label="Yield percent per batch" />
              )}
            </Card>
            <Card title="Yield by target temperature" subtitle="Which temperature gives you the best yield">
              {tempBands.length === 0 ? (
                <EmptyState icon={Thermometer} title="Not enough data yet">
                  Weigh a few dried batches to compare temperatures.
                </EmptyState>
              ) : (
                <ChartCanvas type="bar" data={tempData} options={tempOptions} label="Average yield per 5 degree temperature band" />
              )}
            </Card>
          </div>

          <div className="two-col-even">
            <Card title="Planned vs actual drying time" subtitle="Latest 12 completed runs (hours)">
              {recentTimed.length === 0 ? (
                <EmptyState icon={Clock} title="No timed runs yet" />
              ) : (
                <ChartCanvas type="bar" data={timeData} options={HOURS_OPTIONS} label="Planned and actual hours per run" />
              )}
            </Card>
            <Card title="How runs ended" subtitle="Finished runs by end reason">
              <ChartCanvas type="bar" data={endReasons} options={HORIZONTAL_COUNT_OPTIONS} height={220} label="Runs by end reason" />
            </Card>
          </div>
        </>
      )}

      <Card title="Inventory right now" subtitle="Batches by status (not affected by the date range)">
        <ChartCanvas type="bar" data={inventoryData} options={inventoryOptions} height={180} label="Inventory batches by status" />
      </Card>
    </>
  );
}

const STACKED_COUNT_OPTIONS = {
  plugins: { tooltip: { mode: "index", intersect: false } },
  scales: {
    x: categoryAxis({ stacked: true }),
    y: axis({ stacked: true, beginAtZero: true, ticks: { precision: 0, color: "#64748b" }, title: { text: "Runs" } }),
  },
};

const KG_OPTIONS = {
  plugins: {
    tooltip: { mode: "index", intersect: false, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.formattedValue} kg` } },
  },
  scales: { x: categoryAxis(), y: axis({ beginAtZero: true, title: { text: "kg" } }) },
};

const HOURS_OPTIONS = {
  plugins: {
    tooltip: { mode: "index", intersect: false, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatHours(ctx.raw)}` } },
  },
  scales: { x: categoryAxis(), y: axis({ beginAtZero: true, title: { text: "Hours" } }) },
};

const HORIZONTAL_COUNT_OPTIONS = {
  indexAxis: "y",
  plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.formattedValue} run(s)` } } },
  scales: { y: categoryAxis(), x: axis({ beginAtZero: true, ticks: { precision: 0, color: "#64748b" } }) },
};

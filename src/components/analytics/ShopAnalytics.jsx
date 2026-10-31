import { BadgeCheck, Ban, Package, PhilippinePeso, Receipt, ShoppingBag, ShoppingCart, Wallet } from "lucide-react";
import { useMemo } from "react";
import { PAYMENT, RESERVATION } from "../../config/constants";
import {
  axis,
  categoryAxis,
  groupBy,
  makeBuckets,
  SERIES,
  STATUS_COLORS,
  sum,
  WEEKDAYS,
  weekdayIndex,
} from "../../lib/analytics";
import { formatGrams, formatPercent, formatPeso, toDate } from "../../lib/format";
import { Card, StatCard } from "../ui/Card";
import { EmptyState } from "../ui/States";
import ChartCanvas from "./ChartCanvas";

const bar = { borderRadius: 4, borderSkipped: "start", maxBarThickness: 36 };
const stackedBar = { ...bar, borderSkipped: false, borderColor: "#ffffff", borderWidth: 2 };
const OPEN = [RESERVATION.RESERVED, RESERVATION.READY];
const peso = (v) => formatPeso(v).replace(".00", "");

export default function ShopAnalytics({ reservations, products, start }) {
  const s = useMemo(() => {
    const withTime = reservations.map((r) => {
      const created = toDate(r.createdAt);
      return { ...r, created, time: created?.getTime() ?? 0 };
    });
    const inRange = withTime.filter((r) => r.time >= start);
    const active = inRange.filter((r) => r.status !== RESERVATION.CANCELLED);
    const completed = inRange.filter((r) => r.status === RESERVATION.COMPLETED);
    const open = inRange.filter((r) => OPEN.includes(r.status));
    const cancelled = inRange.filter((r) => r.status === RESERVATION.CANCELLED);
    return {
      inRange,
      active,
      completed,
      open,
      cancelled,
      revenue: sum(completed, (r) => r.total),
      openValue: sum(open, (r) => r.total),
      avgOrder: active.length ? sum(active, (r) => r.total) / active.length : null,
      gramsSold: sum(completed, (r) => r.grams),
      cancelRate: inRange.length ? (cancelled.length / inRange.length) * 100 : null,
      toVerify: withTime.filter((r) => OPEN.includes(r.status) && r.paymentStatus === PAYMENT.SUBMITTED).length,
      customers: new Set(active.map((r) => r.customerId)).size,
      availableGrams: sum(products.filter((p) => p.published), (p) => p.availableGrams),
    };
  }, [reservations, products, start]);

  /* Revenue per period: collected vs still open */
  const revenueOverTime = useMemo(() => {
    const b = makeBuckets(start);
    const collected = new Array(b.size).fill(0);
    const pending = new Array(b.size).fill(0);
    const orders = new Array(b.size).fill(0);
    s.active.forEach((r) => {
      const i = b.indexOf(r.time);
      if (i < 0) return;
      orders[i] += 1;
      if (r.status === RESERVATION.COMPLETED) collected[i] += r.total ?? 0;
      else pending[i] += r.total ?? 0;
    });
    return {
      orders,
      data: {
        labels: b.labels,
        datasets: [
          { label: "Collected", data: collected, backgroundColor: SERIES[0], ...stackedBar },
          { label: "Open orders", data: pending, backgroundColor: SERIES[1], ...stackedBar },
        ],
      },
    };
  }, [s.active, start]);
  const revenueOptions = useMemo(
    () => ({
      plugins: {
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${peso(ctx.raw)}`,
            footer: (items) => {
              const i = items[0]?.dataIndex ?? 0;
              const n = revenueOverTime.orders[i];
              return `${n} order${n === 1 ? "" : "s"}`;
            },
          },
        },
      },
      scales: {
        x: categoryAxis({ stacked: true }),
        y: axis({ stacked: true, beginAtZero: true, ticks: { color: "#64748b", callback: (v) => peso(v) } }),
      },
    }),
    [revenueOverTime],
  );

  /* Order pipeline */
  const pipeline = useMemo(() => {
    const steps = [
      { status: RESERVATION.RESERVED, label: "Reserved", color: SERIES[1] },
      { status: RESERVATION.READY, label: "Ready for pickup", color: SERIES[2] },
      { status: RESERVATION.COMPLETED, label: "Collected", color: STATUS_COLORS.good },
      { status: RESERVATION.CANCELLED, label: "Cancelled", color: STATUS_COLORS.neutral },
    ];
    const list = steps.map((x) => ({ ...x, items: s.inRange.filter((r) => r.status === x.status) }));
    return {
      list,
      data: {
        labels: list.map((x) => x.label),
        datasets: [{ label: "Orders", data: list.map((x) => x.items.length), backgroundColor: list.map((x) => x.color), ...bar }],
      },
    };
  }, [s.inRange]);
  const pipelineOptions = useMemo(
    () => ({
      indexAxis: "y",
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.formattedValue} order(s)`,
            afterLabel: (ctx) => ` ${peso(sum(pipeline.list[ctx.dataIndex].items, (r) => r.total))}`,
          },
        },
      },
      scales: { y: categoryAxis(), x: axis({ beginAtZero: true, ticks: { precision: 0, color: "#64748b" } }) },
    }),
    [pipeline],
  );

  /* Top products by revenue (non-cancelled orders) */
  const topProducts = useMemo(() => {
    const groups = groupBy(s.active, (r) => r.productId);
    return [...groups.values()]
      .map((items) => ({
        name: items[0].productName || items[0].batchNumber || "Product",
        revenue: sum(items, (r) => r.total),
        grams: sum(items, (r) => r.grams),
        orders: items.length,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [s.active]);
  const productData = useMemo(
    () => ({
      labels: topProducts.map((p) => (p.name.length > 22 ? `${p.name.slice(0, 21)}…` : p.name)),
      datasets: [{ label: "Revenue", data: topProducts.map((p) => p.revenue), backgroundColor: SERIES[0], ...bar }],
    }),
    [topProducts],
  );
  const productOptions = useMemo(
    () => ({
      indexAxis: "y",
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => topProducts[items[0].dataIndex].name,
            label: (ctx) => ` ${peso(ctx.raw)}`,
            afterLabel: (ctx) => {
              const p = topProducts[ctx.dataIndex];
              return ` ${p.orders} order(s) · ${formatGrams(p.grams)}`;
            },
          },
        },
      },
      scales: { y: categoryAxis(), x: axis({ beginAtZero: true, ticks: { color: "#64748b", callback: (v) => peso(v) } }) },
    }),
    [topProducts],
  );

  /* Package sizes customers pick */
  const packages = useMemo(() => {
    const groups = groupBy(s.active, (r) => r.packageGrams);
    return [...groups.entries()]
      .map(([grams, items]) => ({ grams: Number(grams), units: sum(items, (r) => r.quantity), revenue: sum(items, (r) => r.total) }))
      .sort((a, b) => a.grams - b.grams);
  }, [s.active]);
  const packageData = useMemo(
    () => ({
      labels: packages.map((p) => formatGrams(p.grams)),
      datasets: [{ label: "Packs sold", data: packages.map((p) => p.units), backgroundColor: SERIES[2], ...bar }],
    }),
    [packages],
  );
  const packageOptions = useMemo(
    () => ({
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.formattedValue} pack(s)`,
            afterLabel: (ctx) => ` ${peso(packages[ctx.dataIndex].revenue)}`,
          },
        },
      },
      scales: { x: categoryAxis(), y: axis({ beginAtZero: true, ticks: { precision: 0, color: "#64748b" }, title: { text: "Packs" } }) },
    }),
    [packages],
  );

  /* Busiest days of the week */
  const weekdays = useMemo(() => {
    const counts = new Array(7).fill(0);
    s.active.forEach((r) => r.created && (counts[weekdayIndex(r.created)] += 1));
    return {
      labels: WEEKDAYS,
      datasets: [{ label: "Orders", data: counts, backgroundColor: SERIES[0], ...bar }],
    };
  }, [s.active]);

  /* GCash payment checks (pay-first) */
  const payments = useMemo(() => {
    const statuses = [
      { key: PAYMENT.VERIFIED, label: "Verified", color: STATUS_COLORS.good },
      { key: PAYMENT.SUBMITTED, label: "Waiting for check", color: STATUS_COLORS.warning },
      { key: PAYMENT.REJECTED, label: "Not found", color: STATUS_COLORS.bad },
      { key: PAYMENT.UNPAID, label: "Unpaid (old orders)", color: STATUS_COLORS.neutral },
    ].map((x) => ({ ...x, items: s.active.filter((r) => r.paymentStatus === x.key) }))
      .filter((x) => x.key !== PAYMENT.UNPAID || x.items.length > 0);
    return {
      list: statuses,
      data: {
        labels: statuses.map((x) => x.label),
        datasets: [{ label: "Orders", data: statuses.map((x) => x.items.length), backgroundColor: statuses.map((x) => x.color), ...bar }],
      },
    };
  }, [s.active]);
  const paymentOptions = useMemo(
    () => ({
      indexAxis: "y",
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.formattedValue} order(s)`,
            afterLabel: (ctx) => ` ${peso(sum(payments.list[ctx.dataIndex].items, (r) => r.total))}`,
          },
        },
      },
      scales: { y: categoryAxis(), x: axis({ beginAtZero: true, ticks: { precision: 0, color: "#64748b" } }) },
    }),
    [payments],
  );

  /* Stock per listing: sold / reserved / still available */
  const stock = useMemo(() => {
    const byProduct = groupBy(
      reservations.filter((r) => r.status !== RESERVATION.CANCELLED),
      (r) => r.productId,
    );
    const list = products
      .filter((p) => p.listedGrams > 0)
      .map((p) => {
        const items = byProduct.get(p.id) ?? [];
        const sold = sum(items.filter((r) => r.status === RESERVATION.COMPLETED), (r) => r.grams);
        const held = Math.max(0, p.listedGrams - p.availableGrams - sold);
        return { name: p.name || p.batchNumber, sold, held, available: p.availableGrams, published: p.published };
      })
      .slice(0, 8);
    return {
      list,
      data: {
        labels: list.map((p) => `${p.name.length > 20 ? `${p.name.slice(0, 19)}…` : p.name}${p.published ? "" : " (hidden)"}`),
        datasets: [
          { label: "Sold", data: list.map((p) => p.sold), backgroundColor: SERIES[0], ...stackedBar },
          { label: "Reserved", data: list.map((p) => p.held), backgroundColor: SERIES[1], ...stackedBar },
          { label: "Available", data: list.map((p) => p.available), backgroundColor: STATUS_COLORS.neutral, ...stackedBar },
        ],
      },
    };
  }, [products, reservations]);

  /* Top customers */
  const topCustomers = useMemo(() => {
    const groups = groupBy(s.active, (r) => r.customerId);
    return [...groups.values()]
      .map((items) => ({
        id: items[0].customerId,
        name: items[0].customerName || "Customer",
        orders: items.length,
        grams: sum(items, (r) => r.grams),
        spend: sum(items, (r) => r.total),
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);
  }, [s.active]);

  const repeatRate = useMemo(() => {
    const groups = groupBy(s.active, (r) => r.customerId);
    if (groups.size === 0) return null;
    return ([...groups.values()].filter((x) => x.length > 1).length / groups.size) * 100;
  }, [s.active]);

  return (
    <>
      <div className="stat-grid">
        <StatCard icon={PhilippinePeso} label="Revenue collected" value={peso(s.revenue)} hint={`${s.completed.length} collected orders`} tone="success" />
        <StatCard icon={Wallet} label="Open order value" value={peso(s.openValue)} hint={`${s.open.length} orders not yet picked up`} tone="orange" />
        <StatCard icon={Receipt} label="Avg. order value" value={s.avgOrder === null ? "--" : peso(s.avgOrder)} hint={`${s.active.length} orders`} tone="primary" />
        <StatCard icon={ShoppingBag} label="Dried sold" value={formatGrams(s.gramsSold)} hint="Collected orders" tone="primary" />
        <StatCard icon={ShoppingCart} label="Customers" value={s.customers} hint={`${formatPercent(repeatRate, 0)} came back`} tone="blue" />
        <StatCard icon={Ban} label="Cancellation rate" value={formatPercent(s.cancelRate, 0)} hint={`${s.cancelled.length} cancelled`} tone="neutral" />
        <StatCard icon={BadgeCheck} label="Payments to verify" value={s.toVerify} hint="GCash references waiting" tone="orange" />
        <StatCard icon={Package} label="Stock on sale" value={formatGrams(s.availableGrams)} hint="Available on published listings" tone="blue" />
      </div>

      {s.inRange.length === 0 ? (
        <Card>
          <EmptyState icon={ShoppingCart} title="No reservations in this range">
            Pick a longer range, or wait for customers to reserve from the storefront.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Sales over time" subtitle="Order value per period, by when the order was placed">
            <ChartCanvas type="bar" data={revenueOverTime.data} options={revenueOptions} height={280} label="Revenue per period, collected and open" />
          </Card>

          <div className="two-col-even">
            <Card title="Order pipeline" subtitle="Where orders in this range are now">
              <ChartCanvas type="bar" data={pipeline.data} options={pipelineOptions} height={220} label="Orders by status" />
            </Card>
            <Card title="Top products" subtitle="Revenue from non-cancelled orders">
              <ChartCanvas type="bar" data={productData} options={productOptions} height={220} label="Revenue by product" />
            </Card>
          </div>

          <div className="two-col-even">
            <Card title="Package sizes" subtitle="Which pack sizes customers choose">
              <ChartCanvas type="bar" data={packageData} options={packageOptions} label="Packs sold by size" />
            </Card>
            <Card title="Busiest days" subtitle="Orders placed by day of the week">
              <ChartCanvas type="bar" data={weekdays} options={WEEKDAY_OPTIONS} label="Orders by weekday" />
            </Card>
          </div>

          <div className="two-col-even">
            <Card title="Payment checks" subtitle="GCash payments on non-cancelled orders">
              <ChartCanvas type="bar" data={payments.data} options={paymentOptions} height={200} label="Orders by payment status" />
            </Card>
            <Card title="Top customers" subtitle="By spend, non-cancelled orders">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="num">Orders</th>
                      <th className="num">Bought</th>
                      <th className="num">Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className="num">{c.orders}</td>
                        <td className="num">{formatGrams(c.grams)}</td>
                        <td className="num">{peso(c.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}

      <Card title="Stock by listing" subtitle="Grams sold, reserved and still available (all time)">
        {stock.list.length === 0 ? (
          <EmptyState icon={Package} title="No listings yet">
            List a dried batch in Shop → Manage shop.
          </EmptyState>
        ) : (
          <ChartCanvas
            type="bar"
            data={stock.data}
            options={STOCK_OPTIONS}
            height={Math.max(160, stock.list.length * 44 + 60)}
            label="Grams sold, reserved and available per listing"
          />
        )}
      </Card>
    </>
  );
}

const WEEKDAY_OPTIONS = {
  plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.formattedValue} order(s)` } } },
  scales: { x: categoryAxis(), y: axis({ beginAtZero: true, ticks: { precision: 0, color: "#64748b" }, title: { text: "Orders" } }) },
};

const STOCK_OPTIONS = {
  indexAxis: "y",
  plugins: {
    tooltip: { mode: "index", intersect: false, callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatGrams(ctx.raw)}` } },
  },
  scales: {
    y: categoryAxis({ stacked: true }),
    x: axis({ stacked: true, beginAtZero: true, ticks: { color: "#64748b", callback: (v) => formatGrams(v) } }),
  },
};

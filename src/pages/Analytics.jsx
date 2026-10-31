import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import DryingAnalytics from "../components/analytics/DryingAnalytics";
import ShopAnalytics from "../components/analytics/ShopAnalytics";
import { PageHeader } from "../components/ui/Card";
import { Loading, Notice } from "../components/ui/States";
import { useAuth } from "../context/AuthContext";
import { useShop } from "../context/ShopContext";
import useLiveData from "../hooks/useLiveData";
import useRunReport from "../hooks/useRunReport";
import { RANGES, rangeStart } from "../lib/analytics";
import { toDate } from "../lib/format";
import { subscribeToAllProducts } from "../services/shopService";

/**
 * Reports → Analytics. Two views:
 *   Drying – run outcomes, weight, yield, temperature and timing.
 *   Shop   – sales, orders, products, payments and stock (shop managers only,
 *            because firestore.rules only lets them read every reservation).
 */
export default function Analytics() {
  const { canOperate } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = canOperate && params.get("view") === "shop" ? "shop" : "drying";
  const range = RANGES.some((r) => r.id === params.get("range")) ? params.get("range") : "90d";

  const report = useRunReport();
  const shop = useShop();
  const products = useLiveData(canOperate ? subscribeToAllProducts : null);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  const start = useMemo(() => {
    const times =
      view === "shop"
        ? shop.reservations.map((r) => toDate(r.createdAt)?.getTime() ?? 0)
        : report.rows.map((r) => r.sortTime);
    return rangeStart(range, times);
  }, [view, range, shop.reservations, report.rows]);

  const loading = view === "shop" ? shop.loading || products.loading : report.loading;
  const error = view === "shop" ? shop.error || products.error : report.error;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Analytics"
        description={view === "shop" ? "Sales, orders and stock from the shop." : "Drying performance across your runs."}
      />

      <div className="analytics-toolbar">
        {canOperate ? (
          <div className="segmented" role="tablist" aria-label="Analytics view">
            {[
              ["drying", "Drying"],
              ["shop", "Shop"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={view === id ? "is-active" : ""}
                onClick={() => set("view", id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}

        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              className={range === r.id ? "is-active" : ""}
              onClick={() => set("range", r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {loading ? (
        <Loading />
      ) : view === "shop" ? (
        <ShopAnalytics reservations={shop.reservations} products={products.data} start={start} />
      ) : (
        <DryingAnalytics rows={report.rows} batches={report.batches} start={start} />
      )}
    </div>
  );
}

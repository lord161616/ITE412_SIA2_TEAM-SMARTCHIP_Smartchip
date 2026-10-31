import { Archive, Box, Pencil, Plus, Scale, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, PageHeader, StatCard } from "../components/ui/Card";
import Modal from "../components/ui/Modal";
import { EmptyState, Loading, Notice } from "../components/ui/States";
import StatusBadge from "../components/ui/StatusBadge";
import { BATCH, BATCH_STATUSES, RUN } from "../config/constants";
import { useAuth } from "../context/AuthContext";
import useAction from "../hooks/useAction";
import useLiveData from "../hooks/useLiveData";
import { formatDate, formatKg, formatPercent, toNumber } from "../lib/format";
import { subscribeToRuns } from "../services/dryingService";
import {
  archiveBatch,
  createBatch,
  recordDriedWeight,
  subscribeToInventory,
  updateBatch,
} from "../services/inventoryService";

/** Local date as YYYY-MM-DD (toISOString would give the UTC date). */
const today = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
};

export default function Inventory() {
  const { isAdmin } = useAuth();
  const { data: items, loading, error } = useLiveData(subscribeToInventory);
  const { data: runs } = useLiveData(subscribeToRuns);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [editing, setEditing] = useState(null); // null | {} (new) | batch
  const [weighing, setWeighing] = useState(null); // batch

  const counts = useMemo(() => {
    const c = Object.fromEntries(BATCH_STATUSES.map((s) => [s, 0]));
    items.forEach((i) => (c[i.status] = (c[i.status] ?? 0) + 1));
    return c;
  }, [items]);

  const freshKg = items
    .filter((i) => i.status === BATCH.FRESH)
    .reduce((sum, i) => sum + (toNumber(i.freshWeight) ?? 0), 0);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter === "active" && i.status === BATCH.ARCHIVED) return false;
      if (statusFilter !== "active" && statusFilter !== "all" && i.status !== statusFilter) return false;
      return !term || String(i.batchNumber ?? "").toLowerCase().includes(term);
    });
  }, [items, search, statusFilter]);

  /** Completed runs by id, for copying the dried weight to the batch's last run. */
  const completedRuns = useMemo(
    () => Object.fromEntries(runs.filter((r) => r.status === RUN.COMPLETED).map((r) => [r.id, r])),
    [runs],
  );

  const [archive] = useAction(archiveBatch, {
    confirm: (id) => ({
      title: "Archive this batch?",
      message: `"${items.find((i) => i.id === id)?.batchNumber}" will be hidden from active inventory. The record is kept.`,
      confirmLabel: "Archive",
      danger: true,
    }),
    success: "Batch archived.",
  });

  const filters = [
    ["active", "Active", items.length - (counts[BATCH.ARCHIVED] ?? 0)],
    [BATCH.FRESH, "Fresh", counts[BATCH.FRESH]],
    [BATCH.DRYING, "Drying", counts[BATCH.DRYING]],
    [BATCH.DRIED, "Dried", counts[BATCH.DRIED]],
    [BATCH.ARCHIVED, "Archived", counts[BATCH.ARCHIVED]],
    ["all", "All", items.length],
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations"
        title="Inventory"
        description="Harvested batches, from fresh to dried."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Add batch
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard icon={Box} label="Fresh batches" value={counts[BATCH.FRESH]} hint={`${freshKg.toFixed(2)} kg waiting`} tone="blue" />
        <StatCard label="Drying" value={counts[BATCH.DRYING]} hint="In the dehydrator" tone="primary" />
        <StatCard label="Dried" value={counts[BATCH.DRIED]} hint="Ready to sell / store" tone="success" />
        <StatCard label="Archived" value={counts[BATCH.ARCHIVED]} hint="Hidden from active list" tone="neutral" />
      </div>

      <Card>
        <div className="toolbar">
          <div className="input-with-icon">
            <Search size={16} aria-hidden />
            <input
              className="input"
              placeholder="Search batch ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search batches"
            />
          </div>
          <div className="segmented" role="tablist" aria-label="Filter by status">
            {filters.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statusFilter === key}
                className={statusFilter === key ? "is-active" : ""}
                onClick={() => setStatusFilter(key)}
              >
                {label}
                <span className="count">{count ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <EmptyState icon={Box} title={items.length ? "No batches match" : "No batches yet"}>
            {items.length ? "Try another search or filter." : "Add your first harvested batch to get started."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch ID</th>
                  <th>Harvested</th>
                  <th className="num">Fresh</th>
                  <th className="num">Dried</th>
                  <th className="num">Yield</th>
                  <th>Status</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const fresh = toNumber(item.freshWeight);
                  const dried = toNumber(item.driedWeight);
                  const yieldPct = fresh && dried !== null ? (dried / fresh) * 100 : null;
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.batchNumber}</strong>
                      </td>
                      <td>{formatDate(item.harvestDate)}</td>
                      <td className="num">{formatKg(fresh)}</td>
                      <td className="num">{formatKg(dried)}</td>
                      <td className="num">{formatPercent(yieldPct)}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>
                        <div className="table-actions">
                          {item.status === BATCH.FRESH && (
                            <button type="button" className="icon-btn" title="Edit batch" onClick={() => setEditing(item)}>
                              <Pencil size={16} />
                            </button>
                          )}
                          {item.status === BATCH.DRIED && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setWeighing(item)}
                              title="Record dried weight"
                            >
                              <Scale size={14} /> {dried === null ? "Weigh" : "Re-weigh"}
                            </button>
                          )}
                          {isAdmin && [BATCH.FRESH, BATCH.DRIED].includes(item.status) && (
                            <button type="button" className="icon-btn" title="Archive batch" onClick={() => archive(item.id)}>
                              <Archive size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <BatchForm batch={editing} onClose={() => setEditing(null)} />}
      {weighing && (
        <DriedWeightForm
          batch={weighing}
          runId={completedRuns[weighing.lastRunId] ? weighing.lastRunId : null}
          onClose={() => setWeighing(null)}
        />
      )}
    </div>
  );
}

function BatchForm({ batch, onClose }) {
  const isNew = !batch.id;
  const [form, setForm] = useState({
    batchNumber: batch.batchNumber ?? "",
    freshWeight: batch.freshWeight ?? "",
    harvestDate: batch.harvestDate ?? today(),
  });

  const [save, saving] = useAction((data) => (isNew ? createBatch(data) : updateBatch(batch.id, data)), {
    success: isNew ? "Batch added." : "Batch updated.",
    onSuccess: onClose,
  });

  const update = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  return (
    <Modal
      open
      title={isNew ? "Add harvested batch" : `Edit ${batch.batchNumber}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="batch-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : isNew ? "Add batch" : "Save changes"}
          </button>
        </>
      }
    >
      <form
        id="batch-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <div className="field">
          <label htmlFor="batchNumber">Batch ID</label>
          <input id="batchNumber" name="batchNumber" className="input" maxLength={50} placeholder="e.g. OY-2026-014" value={form.batchNumber} onChange={update} autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="freshWeight">Fresh weight (kg)</label>
          <input id="freshWeight" name="freshWeight" className="input" type="number" min="0.01" step="0.01" value={form.freshWeight} onChange={update} required />
        </div>
        <div className="field">
          <label htmlFor="harvestDate">Harvest date</label>
          <input id="harvestDate" name="harvestDate" className="input" type="date" max={today()} value={form.harvestDate} onChange={update} required />
        </div>
      </form>
    </Modal>
  );
}

function DriedWeightForm({ batch, runId, onClose }) {
  const [weight, setWeight] = useState(batch.driedWeight ?? "");
  const fresh = toNumber(batch.freshWeight);
  const yieldPct = fresh && toNumber(weight) !== null ? (Number(weight) / fresh) * 100 : null;

  const [save, saving] = useAction(recordDriedWeight, { success: "Dried weight saved.", onSuccess: onClose });

  return (
    <Modal
      open
      size="sm"
      title={`Dried weight — ${batch.batchNumber}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="dried-form" className="btn btn-primary" disabled={saving || weight === ""}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form
        id="dried-form"
        onSubmit={(e) => {
          e.preventDefault();
          save({ batchId: batch.id, runId, driedWeight: weight });
        }}
      >
        <div className="field">
          <label htmlFor="driedWeight">Weight after drying (kg)</label>
          <input id="driedWeight" className="input" type="number" min="0" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} autoFocus />
          <span className="field-hint">
            Fresh weight {formatKg(fresh)} · yield {formatPercent(yieldPct)}
          </span>
        </div>
      </form>
    </Modal>
  );
}

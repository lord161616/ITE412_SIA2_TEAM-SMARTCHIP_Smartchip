import { CirclePlay, PackagePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BATCH, DURATION_LIMITS, TEMP_LIMITS } from "../../config/constants";
import { useAuth } from "../../context/AuthContext";
import { useDevice } from "../../context/DeviceContext";
import useAction from "../../hooks/useAction";
import useLiveData from "../../hooks/useLiveData";
import { formatDate, formatKg, formatMinutes } from "../../lib/format";
import { isReadyForRun } from "../../services/deviceService";
import { startDryingRun, validateRunSettings } from "../../services/dryingService";
import { subscribeToInventory } from "../../services/inventoryService";
import { EmptyState, Notice } from "../ui/States";

const EMPTY_FORM = { batchId: "", targetTemp: String(TEMP_LIMITS.default), durationHours: "" };

/** The ESP32 counts in whole minutes. */
const toMinutes = (hours) => Math.round(Number(hours) * 60);

/** Start a new drying run. Shown by MachinePanel when the machine is idle. */
export default function StartRunForm() {
  const { user } = useAuth();
  const { online, device } = useDevice();
  const { data: inventory, loading } = useLiveData(subscribeToInventory);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  // Live list: a batch added in Inventory shows up here without refreshing.
  const freshBatches = useMemo(() => inventory.filter((b) => b.status === BATCH.FRESH), [inventory]);
  const selected = freshBatches.find((b) => b.id === form.batchId);

  const [start, starting] = useAction(startDryingRun, {
    confirm: ({ targetTemp, durationMinutes }) => ({
      title: `Start drying ${selected?.batchNumber ?? "this batch"}?`,
      message: (
        <ul className="confirm-list">
          <li>
            Target temperature: <strong>{targetTemp} °C</strong>
          </li>
          <li>
            Drying time: <strong>{formatMinutes(durationMinutes)}</strong> (the timer starts once the chamber reaches the target)
          </li>
          <li>
            Fresh weight: <strong>{formatKg(selected?.freshWeight)}</strong>
          </li>
        </ul>
      ),
      confirmLabel: "Send START",
    }),
    success: (result) => `START sent for ${result.batchNumber}. Waiting for the ESP32…`,
    onSuccess: () => setForm(EMPTY_FORM),
  });

  const update = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFormError("");
  };

  const submit = (event) => {
    event.preventDefault();
    if (!form.batchId) return setFormError("Choose a Fresh batch.");
    const settings = { targetTemp: Number(form.targetTemp), durationMinutes: toMinutes(form.durationHours) };
    const problem = validateRunSettings(settings);
    if (problem) return setFormError(problem);
    start({ batchId: form.batchId, ...settings, uid: user?.uid });
  };

  if (!loading && freshBatches.length === 0) {
    return (
      <EmptyState
        icon={PackagePlus}
        title="No Fresh batches to dry"
        action={
          <Link to="/inventory" className="btn btn-primary">
            Add a batch in Inventory
          </Link>
        }
      >
        Add a harvested batch first, then come back to start drying it.
      </EmptyState>
    );
  }

  const disabled = starting || !online || !isReadyForRun(device);

  return (
    <form onSubmit={submit} noValidate>
      {!online && (
        <Notice tone="warning" title="Device offline">
          Turn on the dehydrator and wait for it to come online before starting.
        </Notice>
      )}
      {formError && (
        <div className="form-error">
          <Notice tone="error">{formError}</Notice>
        </div>
      )}

      <div className="form-grid start-form">
        <div className="field field-wide">
          <label htmlFor="batchId">Fresh batch</label>
          <select id="batchId" name="batchId" className="select" value={form.batchId} onChange={update} disabled={disabled || loading}>
            <option value="">{loading ? "Loading batches…" : "Choose a batch"}</option>
            {freshBatches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNumber} — {formatKg(b.freshWeight)} · harvested {formatDate(b.harvestDate)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="targetTemp">Target temperature (°C)</label>
          <input
            id="targetTemp"
            name="targetTemp"
            type="number"
            className="input"
            min={TEMP_LIMITS.min}
            max={TEMP_LIMITS.max}
            step="0.5"
            value={form.targetTemp}
            onChange={update}
            disabled={disabled}
          />
          <span className="field-hint">
            {TEMP_LIMITS.min}–{TEMP_LIMITS.max} °C (ESP32 cuts power at {TEMP_LIMITS.hardSafety} °C)
          </span>
        </div>

        <div className="field">
          <label htmlFor="durationHours">Drying time (hours)</label>
          <input
            id="durationHours"
            name="durationHours"
            type="number"
            className="input"
            min={0.25}
            max={DURATION_LIMITS.maxMinutes / 60}
            step="0.25"
            placeholder="e.g. 8"
            value={form.durationHours}
            onChange={update}
            disabled={disabled}
          />
          <span className="field-hint">
            {form.durationHours ? formatMinutes(toMinutes(form.durationHours)) : `Up to ${DURATION_LIMITS.maxMinutes / 60} h, counted after preheating`}
          </span>
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={disabled}>
          <CirclePlay size={16} /> {starting ? "Starting…" : "Start drying"}
        </button>
      </div>
    </form>
  );
}

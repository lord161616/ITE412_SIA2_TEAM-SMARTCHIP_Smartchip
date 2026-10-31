import { useState } from "react";
import useAction from "../../hooks/useAction";
import { saveShopSettings } from "../../services/shopService";
import Modal from "../ui/Modal";

const FIELDS = [
  ["gcashNumber", "GCash number", "09xx xxx xxxx", 30, "Customers send payment here."],
  ["gcashName", "GCash account name", "e.g. J. Dela Cruz", 80, "Shown so customers can check they have the right account."],
  ["pickupAddress", "Pickup address", "Agrigold Farm, Victoria, Oriental Mindoro", 200],
  ["pickupHours", "Pickup hours", "Mon–Sat, 8 AM – 5 PM", 120],
  ["contactPhone", "Contact number for customers", "+63 9xx xxx xxxx", 30],
];

/** Payment and pickup details shown to customers. */
export default function SettingsModal({ settings, onClose }) {
  const [form, setForm] = useState({ ...settings });
  const [save, saving] = useAction(saveShopSettings, { success: "Shop settings saved.", onSuccess: onClose });

  return (
    <Modal
      open
      title="Shop settings"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form
        id="settings-form"
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        {FIELDS.map(([key, label, placeholder, max, hint]) => (
          <div key={key} className="field">
            <label htmlFor={`set-${key}`}>{label}</label>
            <input
              id={`set-${key}`}
              className="input"
              value={form[key]}
              placeholder={placeholder}
              maxLength={max}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
            {hint && <div className="field-hint">{hint}</div>}
          </div>
        ))}
        <div className="field">
          <label htmlFor="set-notes">Note on the storefront (optional)</label>
          <textarea
            id="set-notes"
            className="input"
            rows={2}
            maxLength={500}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="e.g. Orders are usually ready the next day."
          />
        </div>
      </form>
    </Modal>
  );
}

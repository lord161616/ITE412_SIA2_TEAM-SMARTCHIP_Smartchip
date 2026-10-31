import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { SHOP_LIMITS } from "../../config/constants";
import { useAuth } from "../../context/AuthContext";
import useAction from "../../hooks/useAction";
import { formatGrams, formatPeso } from "../../lib/format";
import { newReservationId, reservationCode, reserveProduct } from "../../services/shopService";
import Modal from "../ui/Modal";
import { Notice } from "../ui/States";

const localDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
};

/**
 * Choose package + quantity + pickup, pay by GCash, then place the order with
 * the GCash reference. Pay first: there's no way to order without paying.
 */
export default function ReserveModal({ product, settings, onClose, onReserved }) {
  const { user, profile } = useAuth();
  const [reservationId] = useState(newReservationId); // so the code can go in the GCash message
  const hasGcash = Boolean(settings.gcashNumber);
  const firstFit = Math.max(0, product.packages.findIndex((p) => p.grams <= product.availableGrams));
  const [form, setForm] = useState({
    packageIndex: firstFit,
    quantity: 1,
    pickupDate: localDate(1),
    note: "",
    reference: "",
    name: profile?.nickname ?? "",
    phone: profile?.phone ?? "",
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const pkg = product.packages[form.packageIndex];
  const qty = Number(form.quantity) || 0;
  const maxQty = Math.min(SHOP_LIMITS.maxQuantity, Math.floor(product.availableGrams / pkg.grams));
  const tooMany = qty > maxQty;

  const [reserve, reserving] = useAction(reserveProduct, {
    success: "Order placed! The farm will confirm your GCash payment, then prepare your order.",
    onSuccess: (id) => onReserved(id),
  });

  function submit(e) {
    e.preventDefault();
    reserve({
      reservationId,
      paymentReference: form.reference,
      productId: product.id,
      packageIndex: form.packageIndex,
      quantity: qty,
      pickupDate: form.pickupDate,
      note: form.note,
      customer: { uid: user.uid, email: user.email, name: form.name, phone: form.phone },
    });
  }

  const stepQty = (delta) =>
    setForm((f) => ({ ...f, quantity: Math.max(1, Math.min(maxQty || 1, (Number(f.quantity) || 0) + delta)) }));

  return (
    <Modal
      open
      title={`Order: ${product.name}`}
      onClose={onClose}
      busy={reserving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={reserving}>
            Cancel
          </button>
          <button
            type="submit"
            form="reserve-form"
            className="btn btn-primary"
            disabled={reserving || tooMany || qty < 1 || !hasGcash || form.reference.trim().length < 4}
          >
            {reserving ? "Placing order…" : `I've paid ${formatPeso(pkg.price * qty)} · Place order`}
          </button>
        </>
      }
    >
      <form id="reserve-form" className="modal-form" onSubmit={submit}>
        <fieldset className="field">
          <legend>Package size</legend>
          <div className="choice-grid">
            {product.packages.map((p, i) => {
              const fits = p.grams <= product.availableGrams;
              return (
                <label key={p.grams} className={`choice ${form.packageIndex === i ? "is-selected" : ""} ${fits ? "" : "is-disabled"}`}>
                  <input
                    type="radio"
                    name="package"
                    checked={form.packageIndex === i}
                    disabled={!fits}
                    onChange={() => setForm((f) => ({ ...f, packageIndex: i, quantity: 1 }))}
                  />
                  <strong>{formatGrams(p.grams)}</strong>
                  <span>{formatPeso(p.price)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="reserve-qty">Quantity</label>
          <div className="qty">
            <button type="button" className="icon-btn" onClick={() => stepQty(-1)} aria-label="Fewer">
              <Minus size={16} />
            </button>
            <input
              id="reserve-qty"
              className="input"
              type="number"
              min={1}
              max={maxQty}
              value={form.quantity}
              onChange={set("quantity")}
            />
            <button type="button" className="icon-btn" onClick={() => stepQty(1)} aria-label="More">
              <Plus size={16} />
            </button>
            <span className="muted">
              = {formatGrams(pkg.grams * qty)} · up to {maxQty} available
            </span>
          </div>
          {tooMany && <div className="form-error">Only {maxQty} of this size left.</div>}
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="reserve-name">Your name</label>
            <input id="reserve-name" className="input" value={form.name} onChange={set("name")} required maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="reserve-phone">Contact number</label>
            <input
              id="reserve-phone"
              className="input"
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              required
              minLength={7}
              maxLength={30}
              placeholder="09xx xxx xxxx"
            />
          </div>
          <div className="field">
            <label htmlFor="reserve-date">Preferred pickup date</label>
            <input id="reserve-date" className="input" type="date" min={localDate(0)} value={form.pickupDate} onChange={set("pickupDate")} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="reserve-note">Note for the farm (optional)</label>
          <textarea id="reserve-note" className="input" rows={2} value={form.note} onChange={set("note")} maxLength={300} />
        </div>

        <fieldset className="field">
          <legend>Pay first by GCash</legend>
          {hasGcash ? (
            <div className="pay-steps">
              <ol>
                <li>
                  Send <strong>{formatPeso(pkg.price * qty)}</strong> by GCash to <strong>{settings.gcashNumber}</strong>
                  {settings.gcashName && <> ({settings.gcashName})</>}.
                </li>
                <li>
                  Put <strong>{reservationCode(reservationId)}</strong> in the GCash message.
                </li>
                <li>Enter the reference number from your GCash receipt here.</li>
              </ol>
              <input
                id="reserve-ref"
                className="input"
                inputMode="numeric"
                placeholder="GCash reference no."
                aria-label="GCash reference number"
                value={form.reference}
                onChange={set("reference")}
                required
                minLength={4}
                maxLength={40}
              />
              <p className="muted fine-print">
                Orders are paid in advance. Your stock is held while the farm checks the payment.
              </p>
            </div>
          ) : (
            <Notice tone="warning">
              Online ordering isn't open yet: the farm hasn't added its GCash details. Please check back later
              {settings.contactPhone && <> or call {settings.contactPhone}</>}.
            </Notice>
          )}
        </fieldset>

        {settings.pickupAddress && (
          <Notice tone="info" title="Pickup at the farm">
            {settings.pickupAddress}
            {settings.pickupHours && <> · {settings.pickupHours}</>}
          </Notice>
        )}
      </form>
    </Modal>
  );
}

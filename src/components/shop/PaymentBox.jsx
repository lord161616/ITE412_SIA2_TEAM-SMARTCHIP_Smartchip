import { useState } from "react";
import { PAYMENT, RESERVATION } from "../../config/constants";
import useAction from "../../hooks/useAction";
import { formatPeso } from "../../lib/format";
import { reservationCode, submitGcashReference } from "../../services/shopService";
import { Notice } from "../ui/States";

/**
 * Payment state of one order. Orders are paid when placed, so this mostly
 * says "waiting for the farm" / "paid". If the farm couldn't find the
 * payment, the customer can resend the reference here.
 */
export default function PaymentBox({ reservation: r, settings }) {
  const [reference, setReference] = useState("");
  const [submit, submitting] = useAction(submitGcashReference, {
    success: "Thanks! The farm will check your GCash payment.",
    onSuccess: () => setReference(""),
  });

  const open = [RESERVATION.RESERVED, RESERVATION.READY].includes(r.status);
  if (!open) return null;

  if (r.paymentStatus === PAYMENT.VERIFIED) {
    return <Notice tone="success">Payment received. Thank you!</Notice>;
  }
  if (r.paymentStatus === PAYMENT.SUBMITTED) {
    return (
      <Notice tone="info" title="Payment sent, waiting for the farm to confirm">
        GCash reference <strong>{r.paymentReference}</strong>. You'll see "Paid" here once it's checked.
      </Notice>
    );
  }

  const rejected = r.paymentStatus === PAYMENT.REJECTED && (
    <Notice tone="error" title="The farm couldn't find that payment">
      {r.paymentNote} Check the reference number and send it again. If you didn't pay, cancel the order so
      the stock goes back on sale.
    </Notice>
  );

  // Older orders placed before pay-first.
  if (r.paymentMethod === "cash" && r.paymentStatus === PAYMENT.UNPAID) {
    return (
      <Notice tone="info">
        Pay <strong>{formatPeso(r.total)}</strong> in cash when you collect your order.
      </Notice>
    );
  }

  const hasGcash = settings.gcashNumber;
  return (
    <div className="stack-sm">
      {rejected}
      {hasGcash ? (
        <div className="pay-steps">
          <ol>
            <li>
              Send <strong>{formatPeso(r.total)}</strong> by GCash to <strong>{settings.gcashNumber}</strong>
              {settings.gcashName && <> ({settings.gcashName})</>}.
            </li>
            <li>
              Put <strong>{reservationCode(r.id)}</strong> in the GCash message.
            </li>
            <li>Enter the reference number from your GCash receipt below.</li>
          </ol>
          <form
            className="pay-ref"
            onSubmit={(e) => {
              e.preventDefault();
              submit(r.id, reference);
            }}
          >
            <input
              className="input"
              inputMode="numeric"
              placeholder="GCash reference no."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              aria-label="GCash reference number"
              maxLength={40}
            />
            <button type="submit" className="btn btn-primary" disabled={submitting || reference.trim().length < 4}>
              {submitting ? "Sending…" : "I've paid"}
            </button>
          </form>
        </div>
      ) : (
        <Notice tone="warning">The farm hasn't added its GCash details. Please contact the farm.</Notice>
      )}
    </div>
  );
}

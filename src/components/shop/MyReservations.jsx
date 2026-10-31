import { useState } from "react";
import { PAYMENT, RESERVATION } from "../../config/constants";
import { useAuth } from "../../context/AuthContext";
import useAction from "../../hooks/useAction";
import { formatDate, formatDateTime, formatGrams, formatPeso } from "../../lib/format";
import { cancelReservation, reservationCode } from "../../services/shopService";
import { PaymentBadge, ReservationBadge } from "./ShopBadges";
import PaymentBox from "./PaymentBox";

/** One-line description of a reservation. */
export function ReservationSummary({ r }) {
  return (
    <div className="reservation-summary">
      <div>
        <strong>{r.productName}</strong> · {r.quantity} × {formatGrams(r.packageGrams)} ({formatGrams(r.grams)})
        <div className="muted fine-print">
          {reservationCode(r.id)} · Batch {r.batchNumber} · reserved {formatDateTime(r.createdAt)}
        </div>
      </div>
      <strong className="reservation-total">{formatPeso(r.total)}</strong>
    </div>
  );
}

/** The customer's reservations, open ones first, with what to do next. */
export default function MyReservations({ reservations, settings }) {
  const { user } = useAuth();
  const [showClosed, setShowClosed] = useState(false);
  const [cancel, cancelling] = useAction(cancelReservation, {
    confirm: {
      title: "Cancel this reservation?",
      message: "The mushrooms go back on sale for other customers.",
      confirmLabel: "Cancel reservation",
      cancelLabel: "Keep it",
      danger: true,
    },
    success: "Reservation cancelled.",
  });

  const isOpen = (r) => [RESERVATION.RESERVED, RESERVATION.READY].includes(r.status);
  const open = reservations.filter(isOpen);
  const closed = reservations.filter((r) => !isOpen(r));
  const list = showClosed ? [...open, ...closed] : open;

  return (
    <section className="card">
      <header className="card-header">
        <div>
          <div className="page-eyebrow">Your orders</div>
          <h2>My reservations</h2>
        </div>
        {closed.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide past orders" : `Show past orders (${closed.length})`}
          </button>
        )}
      </header>

      {list.length === 0 && <p className="muted">No open reservations.</p>}

      <div className="reservation-list">
        {list.map((r) => (
          <article key={r.id} className={`reservation-item ${isOpen(r) ? "" : "is-closed"}`}>
            <ReservationSummary r={r} />
            <div className="button-row">
              <ReservationBadge status={r.status} />
              {r.status !== RESERVATION.CANCELLED && <PaymentBadge method={r.paymentMethod} status={r.paymentStatus} />}
              {r.pickupDate && isOpen(r) && <span className="muted fine-print">Pickup: {formatDate(r.pickupDate)}</span>}
            </div>

            {r.status === RESERVATION.READY && (
              <p className="ready-line">
                Your order is ready! Collect it at {settings.pickupAddress || "the farm"}
                {settings.pickupHours && ` (${settings.pickupHours})`}.
              </p>
            )}
            {r.status === RESERVATION.CANCELLED && r.cancelReason && (
              <p className="muted fine-print">Reason: {r.cancelReason}</p>
            )}

            {isOpen(r) && <PaymentBox reservation={r} settings={settings} />}

            {/* Only when the farm couldn't find the payment (or an old unpaid order). Paid orders: contact the farm. */}
            {r.status === RESERVATION.RESERVED && [PAYMENT.UNPAID, PAYMENT.REJECTED].includes(r.paymentStatus) && (
              <div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-danger"
                  disabled={cancelling}
                  onClick={() => cancel({ reservationId: r.id, uid: user.uid })}
                >
                  Cancel reservation
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

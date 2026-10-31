import { PAYMENT, PAYMENT_METHODS, RESERVATION } from "../../config/constants";
import StatusBadge from "../ui/StatusBadge";

const RESERVATION_LOOK = {
  [RESERVATION.RESERVED]: ["Reserved", "info"],
  [RESERVATION.READY]: ["Ready for pickup", "warning"],
  [RESERVATION.COMPLETED]: ["Collected", "success"],
  [RESERVATION.CANCELLED]: ["Cancelled", "muted"],
};

const PAYMENT_LOOK = {
  [PAYMENT.UNPAID]: ["Not paid", "neutral"],
  [PAYMENT.SUBMITTED]: ["To verify", "warning"],
  [PAYMENT.VERIFIED]: ["Paid", "success"],
  [PAYMENT.REJECTED]: ["Payment not found", "danger"],
};

export function ReservationBadge({ status }) {
  const [label, tone] = RESERVATION_LOOK[status] ?? [status, "neutral"];
  return <StatusBadge status={status} label={label} tone={tone} />;
}

/** e.g. "GCash · To verify" */
export function PaymentBadge({ method, status }) {
  const [label, tone] = PAYMENT_LOOK[status] ?? [status, "neutral"];
  return <StatusBadge status={status} label={`${PAYMENT_METHODS[method] ?? method} · ${label}`} tone={tone} />;
}

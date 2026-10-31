import { CheckCircle2, Eye, EyeOff, Inbox, Package, Pencil, Settings, ShoppingBag, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { BATCH, PAYMENT, RESERVATION, SHOP_LIMITS } from "../../config/constants";
import { useAuth } from "../../context/AuthContext";
import { useShop } from "../../context/ShopContext";
import useAction from "../../hooks/useAction";
import useLiveData from "../../hooks/useLiveData";
import { formatDate, formatDateTime, formatGrams, formatPeso, toDate } from "../../lib/format";
import { subscribeToInventory } from "../../services/inventoryService";
import {
  cancelReservation,
  completeReservation,
  markReady,
  rejectPayment,
  reservationCode,
  setListingPublished,
  subscribeToAllProducts,
  verifyPayment,
} from "../../services/shopService";
import { Card, StatCard } from "../ui/Card";
import Modal from "../ui/Modal";
import { EmptyState, Loading, Notice } from "../ui/States";
import ListingModal from "./ListingModal";
import SettingsModal from "./SettingsModal";
import { PaymentBadge, ReservationBadge } from "./ShopBadges";

const OPEN = [RESERVATION.RESERVED, RESERVATION.READY];

const FILTERS = [
  ["todo", "To do", (r) => OPEN.includes(r.status)],
  ["verify", "Payments to verify", (r) => OPEN.includes(r.status) && r.paymentStatus === PAYMENT.SUBMITTED],
  ["ready", "Ready for pickup", (r) => r.status === RESERVATION.READY],
  ["completed", "Collected", (r) => r.status === RESERVATION.COMPLETED],
  ["cancelled", "Cancelled", (r) => r.status === RESERVATION.CANCELLED],
  ["all", "All", () => true],
];

/** Small modal asking for a reason (reject payment / cancel). */
function ReasonModal({ title, label, confirmLabel, placeholder, warning, onSubmit, onClose, busy }) {
  const [text, setText] = useState("");
  return (
    <Modal
      open
      size="sm"
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Back
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onSubmit(text)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {warning && <Notice tone="warning">{warning}</Notice>}
      <div className="field">
        <label htmlFor="reason-text">{label}</label>
        <textarea
          id="reason-text"
          className="input"
          rows={3}
          maxLength={200}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
    </Modal>
  );
}

export default function ShopManager({ settings }) {
  const { user } = useAuth();
  const { reservations, loading, error } = useShop();
  const products = useLiveData(subscribeToAllProducts);
  const inventory = useLiveData(subscribeToInventory);

  const [filter, setFilter] = useState("todo");
  const [listing, setListing] = useState(null); // { batch, product? }
  const [editSettings, setEditSettings] = useState(false);
  const [rejecting, setRejecting] = useState(null); // reservation
  const [cancelling, setCancelling] = useState(null); // reservation
  const [now] = useState(() => Date.now()); // for the "payment not found for a day" flag

  const batches = useMemo(() => Object.fromEntries(inventory.data.map((b) => [b.id, b])), [inventory.data]);
  const listedIds = new Set(products.data.map((p) => p.id));
  const eligible = inventory.data.filter((b) => b.status === BATCH.DRIED && !listedIds.has(b.id));

  const stats = useMemo(() => {
    const open = reservations.filter((r) => OPEN.includes(r.status));
    const done = reservations.filter((r) => r.status === RESERVATION.COMPLETED);
    return {
      toPrepare: open.filter((r) => r.status === RESERVATION.RESERVED && r.paymentStatus === PAYMENT.VERIFIED).length,
      toVerify: open.filter((r) => r.paymentStatus === PAYMENT.SUBMITTED).length,
      ready: open.filter((r) => r.status === RESERVATION.READY).length,
      sales: done.reduce((s, r) => s + (Number(r.total) || 0), 0),
      soldGrams: done.reduce((s, r) => s + (Number(r.grams) || 0), 0),
      soldCount: done.length,
    };
  }, [reservations]);

  const counts = Object.fromEntries(FILTERS.map(([key, , test]) => [key, reservations.filter(test).length]));
  const visible = reservations.filter(FILTERS.find(([key]) => key === filter)[2]);

  const [verify, verifying] = useAction(verifyPayment, {
    confirm: ({ r }) => ({
      title: "Mark this payment as received?",
      message: `Check your GCash app first: ${formatPeso(r.total)} with reference ${r.paymentReference ?? "(none)"} for ${reservationCode(r.id)}.`,
      confirmLabel: "Yes, I received it",
    }),
    success: "Payment marked as received.",
  });
  const [markPaid, markingPaid] = useAction(verifyPayment, {
    confirm: ({ r }) => ({
      title: "Mark as paid?",
      message: `Only if you've received ${formatPeso(r.total)} for ${reservationCode(r.id)} some other way.`,
      confirmLabel: "Mark paid",
    }),
    success: "Marked as paid.",
  });
  const [ready, readying] = useAction(markReady, { success: "Marked ready. The customer will see it in the shop." });
  const [complete, completing] = useAction(completeReservation, {
    confirm: ({ reservation: r }) => ({
      title: "Customer collected the order?",
      message:
        r.paymentStatus === PAYMENT.VERIFIED
          ? `${reservationCode(r.id)} will be closed as collected.`
          : `${reservationCode(r.id)} is an older cash order. Only continue if you've received ${formatPeso(r.total)} in cash.`,
      confirmLabel: r.paymentStatus === PAYMENT.VERIFIED ? "Collected" : `Received ${formatPeso(r.total)} · collected`,
    }),
    success: "Order completed.",
  });
  const [reject, rejectingBusy] = useAction(rejectPayment, {
    success: "Payment marked as not found. The customer can resend the reference, or you can cancel to release the stock.",
    onSuccess: () => setRejecting(null),
  });
  const [cancel, cancelBusy] = useAction(cancelReservation, {
    success: "Reservation cancelled and stock returned.",
    onSuccess: () => setCancelling(null),
  });
  const [togglePublished] = useAction(setListingPublished, {
    success: (_, id, published) => (published ? "Listing is on the storefront." : "Listing hidden from customers."),
  });

  const busy = verifying || markingPaid || readying || completing;

  return (
    <div className="stack">
      <div className="stat-grid">
        <StatCard icon={Inbox} label="To prepare" value={stats.toPrepare} hint="Paid orders" tone="orange" />
        <StatCard icon={Wallet} label="Payments to verify" value={stats.toVerify} hint="GCash references sent" tone="warning" />
        <StatCard icon={ShoppingBag} label="Ready for pickup" value={stats.ready} hint="Waiting for the customer" tone="blue" />
        <StatCard
          icon={CheckCircle2}
          label="Sales (collected)"
          value={formatPeso(stats.sales)}
          hint={`${stats.soldCount} ${stats.soldCount === 1 ? "order" : "orders"} · ${formatGrams(stats.soldGrams)}`}
          tone="success"
        />
      </div>

      {!settings.gcashNumber && (
        <Notice
          tone="warning"
          title="Add your GCash details"
          action={
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditSettings(true)}>
              Shop settings
            </button>
          }
        >
          Orders are pay-first by GCash, so customers can't order until you add your GCash number.
        </Notice>
      )}

      <Card title="Reservations" subtitle="New orders and payments show up here live. You'll also get a pop-up on any page.">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Filter reservations">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={filter === key ? "is-active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="count">{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing here">
            {filter === "todo" ? "No open reservations right now." : "No reservations in this list."}
          </EmptyState>
        ) : (
          <div className="mgr-list">
            {visible.map((r) => {
              const open = OPEN.includes(r.status);
              const ageHours = (now - (toDate(r.createdAt)?.getTime() ?? now)) / 3_600_000;
              const sinceUpdate = (now - (toDate(r.updatedAt)?.getTime() ?? now)) / 3_600_000;
              const overdue =
                open &&
                ((r.paymentStatus === PAYMENT.REJECTED && sinceUpdate > SHOP_LIMITS.unpaidFlagHours) ||
                  (r.paymentStatus === PAYMENT.UNPAID && r.paymentMethod === "gcash" && ageHours > SHOP_LIMITS.unpaidFlagHours));
              const paid = r.paymentStatus === PAYMENT.VERIFIED;
              const oldCash = r.paymentMethod === "cash" && !paid;
              return (
                <article key={r.id} className={`mgr-item ${open ? "" : "is-closed"}`}>
                  <div className="mgr-who">
                    <div>
                      <strong>{reservationCode(r.id)}</strong> · <span className="muted fine-print">{formatDateTime(r.createdAt)}</span>
                    </div>
                    <div>
                      <strong>{r.customerName}</strong>
                    </div>
                    <div className="fine-print">
                      <a href={`tel:${r.customerPhone.replace(/\s/g, "")}`}>{r.customerPhone}</a>
                      {r.customerEmail && (
                        <>
                          {" · "}
                          <a href={`mailto:${r.customerEmail}`}>{r.customerEmail}</a>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mgr-order">
                    <div>
                      {r.quantity} × {formatGrams(r.packageGrams)} <span className="muted">({formatGrams(r.grams)})</span>
                    </div>
                    <div className="muted fine-print">Batch {r.batchNumber}</div>
                    {r.pickupDate && <div className="fine-print">Pickup {formatDate(r.pickupDate)}</div>}
                    {r.note && <div className="fine-print note-line">“{r.note}”</div>}
                  </div>

                  <div className="mgr-state">
                    <ReservationBadge status={r.status} />
                    <PaymentBadge method={r.paymentMethod} status={r.paymentStatus} />
                    {r.paymentReference && <div className="fine-print">Ref {r.paymentReference}</div>}
                    {overdue && (
                      <div className="fine-print text-warning">
                        No valid payment for over {SHOP_LIMITS.unpaidFlagHours} h. Cancel to release the stock.
                      </div>
                    )}
                    {open && r.paymentStatus === PAYMENT.SUBMITTED && (
                      <div className="fine-print muted">Check the payment before preparing this order.</div>
                    )}
                    {r.cancelReason && <div className="muted fine-print">{r.cancelReason}</div>}
                  </div>

                  <div className="mgr-side">
                    <strong className="reservation-total">{formatPeso(r.total)}</strong>
                    {open && (
                      <div className="mgr-actions">
                        {r.paymentStatus === PAYMENT.SUBMITTED && (
                          <>
                            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => verify({ r, reservationId: r.id, uid: user.uid })}>
                              Verify payment
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting(r)}>
                              Not found
                            </button>
                          </>
                        )}
                        {[PAYMENT.UNPAID, PAYMENT.REJECTED].includes(r.paymentStatus) && !oldCash && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => markPaid({ r, reservationId: r.id, uid: user.uid })}>
                            Mark paid
                          </button>
                        )}
                        {r.status === RESERVATION.RESERVED && (paid || oldCash) && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => ready({ reservationId: r.id })}>
                            Mark ready
                          </button>
                        )}
                        {r.status === RESERVATION.READY && (paid || oldCash) && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => complete({ reservation: r, uid: user.uid })}>
                            Collected
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setCancelling(r)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Listings" subtitle="What customers see. Hide a listing to take it off the storefront.">
        {products.error && <Notice tone="error">{products.error}</Notice>}
        {products.loading ? (
          <Loading />
        ) : products.data.length === 0 ? (
          <EmptyState icon={Package} title="No listings yet">
            Publish a dried batch below to start selling.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Packages</th>
                  <th className="num">Available</th>
                  <th className="num">Reserved / sold</th>
                  <th>Storefront</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.data.map((p) => {
                  const batch = batches[p.batchId];
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="muted fine-print">Batch {p.batchNumber}</div>
                      </td>
                      <td className="fine-print">
                        {p.packages.map((pkg) => `${formatGrams(pkg.grams)} ${formatPeso(pkg.price)}`).join(" · ")}
                      </td>
                      <td className="num">
                        {formatGrams(p.availableGrams)}
                        <div className="muted fine-print">of {formatGrams(p.listedGrams)}</div>
                      </td>
                      <td className="num">{formatGrams(p.listedGrams - p.availableGrams)}</td>
                      <td>
                        {p.published ? (
                          <span className="badge badge-success">Published</span>
                        ) : (
                          <span className="badge badge-muted">Hidden</span>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="icon-btn"
                            title={p.published ? "Hide from storefront" : "Show on storefront"}
                            onClick={() => togglePublished(p.id, !p.published)}
                          >
                            {p.published ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={batch ? "Edit listing" : "Loading batch…"}
                            disabled={!batch}
                            onClick={() => setListing({ batch, product: p })}
                          >
                            <Pencil size={16} />
                          </button>
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

      <div className="two-col-even">
        <Card title="Dried batches ready to list" subtitle="From Inventory. Weigh a batch there first.">
          {inventory.loading ? (
            <Loading />
          ) : eligible.length === 0 ? (
            <p className="muted">No unlisted Dried batches. Finish a drying run, then weigh it in Inventory.</p>
          ) : (
            <ul className="eligible-list">
              {eligible.map((b) => {
                const weighed = Number(b.driedWeight) > 0;
                return (
                  <li key={b.id}>
                    <div>
                      <strong>{b.batchNumber}</strong>
                      <div className="muted fine-print">
                        {weighed ? `${formatGrams(Number(b.driedWeight) * 1000)} dried` : "Not weighed yet"} · harvested{" "}
                        {formatDate(b.harvestDate)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!weighed}
                      title={weighed ? "" : "Weigh it in Inventory first"}
                      onClick={() => setListing({ batch: b })}
                    >
                      Publish
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Payment & pickup"
          actions={
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditSettings(true)}>
              <Settings size={14} /> Edit
            </button>
          }
        >
          <dl className="info-grid">
            <div>
              <dt>GCash</dt>
              <dd>{settings.gcashNumber ? `${settings.gcashNumber}${settings.gcashName ? ` (${settings.gcashName})` : ""}` : "Not set"}</dd>
            </div>
            <div>
              <dt>Pickup</dt>
              <dd>{settings.pickupAddress || "Not set"}</dd>
            </div>
            <div>
              <dt>Hours</dt>
              <dd>{settings.pickupHours || "Not set"}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{settings.contactPhone || "Not set"}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {listing && <ListingModal batch={listing.batch} product={listing.product} onClose={() => setListing(null)} />}
      {editSettings && <SettingsModal settings={settings} onClose={() => setEditSettings(false)} />}
      {rejecting && (
        <ReasonModal
          title={`Payment not found · ${reservationCode(rejecting.id)}`}
          label="Message to the customer"
          placeholder="e.g. No GCash payment with that reference. Please check and resend."
          confirmLabel="Send back to customer"
          busy={rejectingBusy}
          onClose={() => setRejecting(null)}
          onSubmit={(note) => reject({ reservationId: rejecting.id, note })}
        />
      )}
      {cancelling && (
        <ReasonModal
          title={`Cancel ${reservationCode(cancelling.id)}?`}
          label="Reason (the customer will see this)"
          placeholder="e.g. Not paid within 24 hours."
          confirmLabel="Cancel reservation"
          warning={
            cancelling.paymentStatus === PAYMENT.VERIFIED || cancelling.paymentStatus === PAYMENT.SUBMITTED
              ? `The customer has paid (or says they have) ${formatPeso(cancelling.total)}. Remember to refund them.`
              : null
          }
          busy={cancelBusy}
          onClose={() => setCancelling(null)}
          onSubmit={(reason) => cancel({ reservationId: cancelling.id, uid: user.uid, reason })}
        />
      )}
    </div>
  );
}

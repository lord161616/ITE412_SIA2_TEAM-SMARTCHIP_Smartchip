import { Droplets, Gauge, Layers, Mail, MapPin, Package, Phone, Sprout, Thermometer, Warehouse } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import mushroom from "../../assets/oyster.jpg";
import { useAuth } from "../../context/AuthContext";
import useLiveData from "../../hooks/useLiveData";
import { formatGrams, formatPeso } from "../../lib/format";
import { subscribeToMyReservations, subscribeToStorefront } from "../../services/shopService";
import Modal from "../ui/Modal";
import { EmptyState, Loading, Notice } from "../ui/States";
import MyReservations, { ReservationSummary } from "./MyReservations";
import PaymentBox from "./PaymentBox";
import ReserveModal from "./ReserveModal";

const FEATURES = [
  [Thermometer, "Temperature monitoring", "Sensors watch the drying chamber to keep conditions controlled."],
  [Droplets, "Humidity monitoring", "Humidity is tracked throughout the drying process."],
  [Gauge, "Controlled drying", "SmartChip runs each cycle to support consistent product quality."],
  [Layers, "Batch records", "Every drying batch is monitored and recorded."],
];

const STEPS = [
  ["Choose a batch", "Pick a dried batch and a package size."],
  ["Pay by GCash", "Send the total by GCash and enter the reference number when you order."],
  ["We confirm", "The farm checks your payment and holds your mushrooms for you."],
  ["Collect", "We'll mark your order ready. Pick it up at the farm."],
];

const FAQ = [
  ["How do I cook dehydrated mushrooms?", "Soak them in warm water for about 10–15 minutes before cooking."],
  ["How should I store them?", "In a clean, dry, sealed container away from moisture."],
  ["Do I have to pay in advance?", "Yes. Orders are paid by GCash when you place them. We don't take cash on pickup."],
  ["Is my order held while you check the payment?", "Yes. Stock is set aside as soon as you order."],
  ["Can I cancel?", "After paying, contact the farm and we'll arrange a refund."],
];

/** Stable subscription for the signed-in customer's reservations. */
function useMyReservations(uid) {
  const subscribe = useCallback((onData, onError) => subscribeToMyReservations(uid, onData, onError), [uid]);
  return useLiveData(uid ? subscribe : null);
}

export default function Storefront({ settings }) {
  const location = useLocation();
  const { user } = useAuth();
  const products = useLiveData(subscribeToStorefront);
  const mine = useMyReservations(user?.uid ?? null);
  const [reserving, setReserving] = useState(null); // product
  const [justReserved, setJustReserved] = useState(null); // reservation id

  const fresh = mine.data.find((r) => r.id === justReserved);

  return (
    <div className="stack">
      <section className="shop-hero">
        <div>
          <div className="page-eyebrow">Agrigold Farm</div>
          <h1>Fresh from our farm</h1>
          <p>Premium dehydrated oyster mushrooms, carefully processed with SmartChip drying technology.</p>
        </div>
      </section>

      {user && mine.data.length > 0 && <MyReservations reservations={mine.data} settings={settings} />}

      <section className="card">
        <div className="page-eyebrow">Available now</div>
        <h2>Dehydrated oyster mushrooms</h2>
        {products.error && <Notice tone="error">{products.error}</Notice>}
        {products.loading ? (
          <Loading />
        ) : products.data.length === 0 ? (
          <EmptyState icon={Sprout} title="No products available yet">
            Our next batch is being prepared. Please check back soon.
          </EmptyState>
        ) : (
          <div className="product-grid">
            {products.data.map((p) => {
              const smallest = Math.min(...p.packages.map((x) => x.grams));
              const soldOut = p.availableGrams < smallest;
              return (
                <article key={p.id} className="product-card">
                  <div className="product-card-image">
                    <img src={mushroom} alt="" />
                    {soldOut && <span className="shop-ribbon">Sold out</span>}
                  </div>
                  <div className="product-card-body">
                    <h3>{p.name}</h3>
                    <div className="muted fine-print">Batch {p.batchNumber}</div>
                    {p.description && <p className="muted">{p.description}</p>}
                    <ul className="package-list">
                      {p.packages.map((pkg) => (
                        <li key={pkg.grams}>
                          <span>{formatGrams(pkg.grams)}</span>
                          <strong>{formatPeso(pkg.price)}</strong>
                        </li>
                      ))}
                    </ul>
                    <div className="product-stock">
                      <Package size={14} aria-hidden /> {soldOut ? "Sold out" : `${formatGrams(p.availableGrams)} available`}
                    </div>
                    {soldOut ? null : user ? (
                      <button type="button" className="btn btn-primary btn-block" onClick={() => setReserving(p)}>
                        Order
                      </button>
                    ) : (
                      <Link to="/login" state={{ from: location.pathname }} className="btn btn-primary btn-block">
                        Sign in to order
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!user && products.data.length > 0 && (
          <p className="muted fine-print">
            New here? <Link to="/register">Create a free account</Link> to order.
          </p>
        )}
      </section>

      <section className="card">
        <div className="page-eyebrow">How to order</div>
        <h2>Pay, reserve, collect</h2>
        <ol className="shop-steps">
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </li>
          ))}
        </ol>
        <div className="shop-delivery">
          <div>
            <Warehouse size={20} aria-hidden />
            <div>
              <strong>Farm pickup</strong>
              <p className="muted">
                {settings.pickupAddress || "Victoria, Oriental Mindoro"}
                {settings.pickupHours && ` · ${settings.pickupHours}`}
              </p>
            </div>
          </div>
        </div>
        {settings.notes && <p className="muted">{settings.notes}</p>}
      </section>

      <section className="card">
        <div className="page-eyebrow">SmartChip technology</div>
        <h2>Carefully processed with SmartChip</h2>
        <div className="shop-features">
          {FEATURES.map(([Icon, title, text]) => (
            <div key={title} className="shop-feature">
              <Icon size={22} aria-hidden />
              <h3>{title}</h3>
              <p className="muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="two-col-even">
        <section className="card">
          <div className="page-eyebrow">Need help?</div>
          <h2>Frequently asked questions</h2>
          <dl className="shop-faq">
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <dt>{q}</dt>
                <dd className="muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <div className="page-eyebrow">About & contact</div>
          <h2>Agrigold Farm</h2>
          <p className="muted">
            Agrigold Farm grows high-quality oyster mushrooms using sustainable cultivation and modern processing.
          </p>
          <ul className="shop-contact">
            <li>
              <MapPin size={16} /> {settings.pickupAddress || "Victoria, Oriental Mindoro, Philippines"}
            </li>
            <li>
              <Mail size={16} /> <a href="mailto:agrigoldfarm@email.com">agrigoldfarm@email.com</a>
            </li>
            <li>
              <Phone size={16} />{" "}
              <a href={`tel:${(settings.contactPhone || "+639663143255").replace(/\s/g, "")}`}>
                {settings.contactPhone || "+63 966 314 3255"}
              </a>
            </li>
          </ul>
        </section>
      </div>

      {reserving && (
        <ReserveModal
          product={reserving}
          settings={settings}
          onClose={() => setReserving(null)}
          onReserved={(id) => {
            setReserving(null);
            setJustReserved(id);
          }}
        />
      )}

      {justReserved && (
        <Modal open title="Reserved! Next: payment" onClose={() => setJustReserved(null)}>
          {fresh ? (
            <div className="stack-sm">
              <ReservationSummary r={fresh} />
              <PaymentBox reservation={fresh} settings={settings} />
              <p className="muted fine-print">You can find this any time under My reservations at the top of the shop.</p>
            </div>
          ) : (
            <Loading />
          )}
        </Modal>
      )}
    </div>
  );
}

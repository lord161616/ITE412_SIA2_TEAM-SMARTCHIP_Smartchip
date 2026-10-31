/**
 * Shop: listings (products), reservations and shop settings.
 *
 * Stock is reserved with a Firestore transaction: the product's
 * availableGrams goes down and the reservation is created in ONE atomic
 * write, and firestore.rules checks both sides. Two customers can't reserve
 * the same grams, and prices can't be changed from the browser.
 *
 * Pay first: there's no payment gateway, so the customer sends the GCash
 * payment BEFORE ordering and enters the reference number in the order
 * form. An order can't be placed without one (firestore.rules checks it).
 * Only the shop manager can mark a payment "verified", after checking their
 * own GCash history, and an order can't be marked ready until it is.
 */
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { BATCH, COLLECTIONS, PAYMENT, RESERVATION, SHOP_LIMITS } from "../config/constants";
import { AppError } from "../lib/errors";
import { db } from "../lib/firebase";
import { toDate } from "../lib/format";

const productsCol = collection(db, COLLECTIONS.products);
const reservationsCol = collection(db, COLLECTIONS.reservations);
const productRef = (id) => doc(db, COLLECTIONS.products, id);
const reservationRef = (id) => doc(db, COLLECTIONS.reservations, id);
const settingsRef = doc(db, COLLECTIONS.shop, "settings");

const byNewest = (field) => (a, b) => (toDate(b[field])?.getTime() ?? 0) - (toDate(a[field])?.getTime() ?? 0);
const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** A new reservation ID, made before ordering so the customer can put its code in the GCash message. */
export const newReservationId = () => doc(reservationsCol).id;

/** Short code customers and the owner can read out, e.g. "R-7K2Q9C". */
export const reservationCode = (id) => `R-${String(id).slice(0, 6).toUpperCase()}`;

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** Published listings, for the storefront (works signed out). */
export function subscribeToStorefront(onData, onError) {
  return onSnapshot(
    query(productsCol, where("published", "==", true)),
    (snap) => onData(mapDocs(snap).sort(byNewest("createdAt"))),
    onError,
  );
}

/** Every listing, published or hidden (shop manager). */
export function subscribeToAllProducts(onData, onError) {
  return onSnapshot(productsCol, (snap) => onData(mapDocs(snap).sort(byNewest("createdAt"))), onError);
}

/** Every reservation (shop manager), newest first. */
export function subscribeToAllReservations(onData, onError) {
  return onSnapshot(reservationsCol, (snap) => onData(mapDocs(snap).sort(byNewest("createdAt"))), onError);
}

/** The signed-in customer's own reservations. */
export function subscribeToMyReservations(uid, onData, onError) {
  return onSnapshot(
    query(reservationsCol, where("customerId", "==", uid)),
    (snap) => onData(mapDocs(snap).sort(byNewest("createdAt"))),
    onError,
  );
}

export const EMPTY_SETTINGS = Object.freeze({
  gcashName: "",
  gcashNumber: "",
  pickupAddress: "",
  pickupHours: "",
  contactPhone: "",
  notes: "",
});

export function subscribeToShopSettings(onData, onError) {
  return onSnapshot(settingsRef, (snap) => onData({ ...EMPTY_SETTINGS, ...(snap.data() ?? {}) }), onError);
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

const cleanReference = (reference) => String(reference ?? "").replace(/\s+/g, "");

/**
 * Places a paid order: `quantity` packages of `packageIndex` from a listing,
 * with the GCash reference of the payment the customer already sent.
 * Throws a friendly error if there isn't enough stock left.
 */
export async function reserveProduct({
  reservationId,
  paymentReference,
  productId,
  packageIndex,
  quantity,
  pickupDate,
  note,
  customer,
}) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > SHOP_LIMITS.maxQuantity) {
    throw new AppError(`Quantity must be a whole number from 1 to ${SHOP_LIMITS.maxQuantity}.`);
  }
  const name = String(customer?.name ?? "").trim();
  const phone = String(customer?.phone ?? "").trim();
  if (!name) throw new AppError("Please enter your name.");
  if (phone.length < 7) throw new AppError("Please enter a contact number so the farm can reach you.");
  const ref = cleanReference(paymentReference);
  if (ref.length < 4 || ref.length > 40) {
    throw new AppError("Send the GCash payment first, then enter the reference number from your receipt.");
  }

  const newRef = reservationId ? reservationRef(reservationId) : doc(reservationsCol);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(productRef(productId));
    if (!snap.exists() || !snap.data().published) throw new AppError("This product is no longer available.");
    const product = snap.data();
    const pkg = product.packages?.[packageIndex];
    if (!pkg) throw new AppError("Choose a package size.");

    const grams = pkg.grams * qty;
    if (grams > product.availableGrams) {
      const left = Math.floor(product.availableGrams / pkg.grams);
      throw new AppError(
        left > 0
          ? `Only ${left} × ${pkg.grams} g left. Lower the quantity and try again.`
          : `Not enough stock left for a ${pkg.grams} g package.`,
      );
    }

    tx.update(productRef(productId), {
      availableGrams: product.availableGrams - grams,
      lastReservationId: newRef.id,
      updatedAt: serverTimestamp(),
    });
    tx.set(newRef, {
      productId,
      batchId: product.batchId,
      batchNumber: product.batchNumber,
      productName: product.name,
      packageIndex,
      packageGrams: pkg.grams,
      unitPrice: pkg.price,
      quantity: qty,
      grams,
      total: pkg.price * qty,
      customerId: customer.uid,
      customerName: name.slice(0, 80),
      customerPhone: phone.slice(0, 30),
      customerEmail: String(customer.email ?? "").slice(0, 120),
      pickupDate: pickupDate || null,
      note: String(note ?? "").trim().slice(0, 300),
      status: RESERVATION.RESERVED,
      paymentMethod: "gcash",
      paymentStatus: PAYMENT.SUBMITTED,
      paymentReference: ref,
      paymentSubmittedAt: serverTimestamp(),
      paymentVerifiedAt: null,
      paymentVerifiedBy: null,
      paymentNote: null,
      readyAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return newRef.id;
}

/** Customer: resend the GCash reference after the farm couldn't find the first one. */
export async function submitGcashReference(reservationId, reference) {
  const ref = cleanReference(reference);
  if (ref.length < 4 || ref.length > 40) throw new AppError("Enter the GCash reference number from your receipt.");
  await updateDoc(reservationRef(reservationId), {
    paymentMethod: "gcash",
    paymentStatus: PAYMENT.SUBMITTED,
    paymentReference: ref,
    paymentSubmittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Puts a reservation's grams back on its listing (never above the listed amount). */
function restock(tx, productId, product, grams, reservationId) {
  const back = Math.min(product.availableGrams + grams, product.listedGrams);
  tx.update(productRef(productId), {
    availableGrams: back,
    lastReservationId: reservationId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Cancels a reservation and returns its stock.
 * Customers: only if the farm couldn't find their payment. Shop manager: any open reservation.
 */
export async function cancelReservation({ reservationId, uid, reason = null }) {
  await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(reservationRef(reservationId));
    if (!rSnap.exists()) throw new AppError("Reservation not found.");
    const r = rSnap.data();
    if (![RESERVATION.RESERVED, RESERVATION.READY].includes(r.status)) {
      throw new AppError("This reservation is already closed.");
    }
    const pSnap = await tx.get(productRef(r.productId));
    if (!pSnap.exists()) throw new AppError("The product listing no longer exists.");

    restock(tx, r.productId, pSnap.data(), r.grams, reservationId);
    tx.update(reservationRef(reservationId), {
      status: RESERVATION.CANCELLED,
      cancelledAt: serverTimestamp(),
      cancelledBy: uid,
      cancelReason: reason ? String(reason).trim().slice(0, 200) || null : null,
      updatedAt: serverTimestamp(),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Shop manager                                                        */
/* ------------------------------------------------------------------ */

/** "100" -> 100 grams; validates the package list from the form. */
function cleanPackages(packages) {
  const list = (packages ?? [])
    .map((p) => ({ grams: Number(p.grams), price: Number(p.price) }))
    .filter((p) => p.grams || p.price);
  if (list.length === 0) throw new AppError("Add at least one package size.");
  if (list.length > SHOP_LIMITS.maxPackages) throw new AppError(`Up to ${SHOP_LIMITS.maxPackages} package sizes.`);
  for (const p of list) {
    if (!Number.isInteger(p.grams) || p.grams < SHOP_LIMITS.minPackageGrams) {
      throw new AppError(`Package sizes must be whole grams, at least ${SHOP_LIMITS.minPackageGrams} g.`);
    }
    if (!Number.isFinite(p.price) || p.price <= 0) throw new AppError("Every package needs a price above ₱0.");
    p.price = Math.round(p.price * 100) / 100;
  }
  const sizes = list.map((p) => p.grams);
  if (new Set(sizes).size !== sizes.length) throw new AppError("Two packages have the same size.");
  return list.sort((a, b) => a.grams - b.grams);
}

function cleanListing({ name, description, listedGrams, packages, published }, maxGrams) {
  const title = String(name ?? "").trim();
  if (!title) throw new AppError("Give the product a name.");
  const grams = Number(listedGrams);
  if (!Number.isInteger(grams) || grams <= 0) throw new AppError("Amount for sale must be whole grams above 0.");
  if (grams > maxGrams) throw new AppError(`This batch only has ${maxGrams} g of dried weight.`);
  const list = cleanPackages(packages);
  if (list[0].grams > grams) throw new AppError("The smallest package is bigger than the amount for sale.");
  return {
    name: title.slice(0, 80),
    description: String(description ?? "").trim().slice(0, 500),
    listedGrams: grams,
    packages: list,
    published: Boolean(published),
  };
}

/** Dried weight in kg -> whole grams available to list. */
export const batchGrams = (batch) => Math.floor((Number(batch?.driedWeight) || 0) * 1000 + 1e-6);

/** Publishes (or saves hidden) a listing for a weighed Dried batch. */
export async function createListing(batch, form) {
  if (batch.status !== BATCH.DRIED) throw new AppError("Only Dried batches can be listed.");
  if (!(Number(batch.driedWeight) > 0)) throw new AppError("Weigh the dried batch in Inventory first.");
  const clean = cleanListing(form, batchGrams(batch));
  const ref = productRef(batch.id);
  if ((await getDoc(ref)).exists()) throw new AppError("This batch already has a listing.");
  await setDoc(ref, {
    ...clean,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    availableGrams: clean.listedGrams,
    lastReservationId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Edits a listing. Changing the amount for sale keeps already-reserved grams
 * reserved: available = new amount − grams currently held by reservations.
 */
export async function updateListing(productId, batch, form) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(productRef(productId));
    if (!snap.exists()) throw new AppError("Listing not found.");
    const current = snap.data();
    const clean = cleanListing(form, batchGrams(batch));
    const held = current.listedGrams - current.availableGrams;
    if (clean.listedGrams < held) {
      throw new AppError(`${held} g is already reserved or sold, so the amount can't go below that.`);
    }
    tx.update(productRef(productId), {
      ...clean,
      availableGrams: clean.listedGrams - held,
      updatedAt: serverTimestamp(),
    });
  });
}

/** Show / hide a listing on the storefront. */
export async function setListingPublished(productId, published) {
  await updateDoc(productRef(productId), { published, updatedAt: serverTimestamp() });
}

/** Shop manager status / payment changes on a reservation. */
async function managerUpdate(reservationId, fields) {
  await updateDoc(reservationRef(reservationId), { ...fields, updatedAt: serverTimestamp() });
}

export const verifyPayment = ({ reservationId, uid }) =>
  managerUpdate(reservationId, {
    paymentStatus: PAYMENT.VERIFIED,
    paymentVerifiedAt: serverTimestamp(),
    paymentVerifiedBy: uid,
    paymentNote: null,
  });

export const rejectPayment = ({ reservationId, note }) =>
  managerUpdate(reservationId, {
    paymentStatus: PAYMENT.REJECTED,
    paymentNote: String(note ?? "").trim().slice(0, 200) || "Reference number didn't match a payment.",
  });

export const markReady = ({ reservationId }) =>
  managerUpdate(reservationId, { status: RESERVATION.READY, readyAt: serverTimestamp() });

export const markNotReady = ({ reservationId }) =>
  managerUpdate(reservationId, { status: RESERVATION.RESERVED, readyAt: null });

/** Customer collected the order. Old cash-on-pickup orders also record the cash payment here. */
export const completeReservation = ({ reservation, uid }) =>
  managerUpdate(reservation.id, {
    status: RESERVATION.COMPLETED,
    completedAt: serverTimestamp(),
    ...(reservation.paymentStatus === PAYMENT.VERIFIED || reservation.paymentMethod !== "cash"
      ? {}
      : { paymentStatus: PAYMENT.VERIFIED, paymentVerifiedAt: serverTimestamp(), paymentVerifiedBy: uid }),
  });

export async function saveShopSettings(form) {
  const clean = Object.fromEntries(
    Object.keys(EMPTY_SETTINGS).map((key) => [key, String(form[key] ?? "").trim()]),
  );
  await setDoc(settingsRef, { ...clean, updatedAt: serverTimestamp() });
}

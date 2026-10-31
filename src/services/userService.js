import { sendPasswordResetEmail } from "firebase/auth";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { ACCOUNT_STATUS, ALL_ROLES, COLLECTIONS, ROLES, STAFF_ROLES } from "../config/constants";
import { AppError } from "../lib/errors";
import { auth, db } from "../lib/firebase";
import { toDate } from "../lib/format";
import { runJob } from "./jobService";

const userRef = (uid) => doc(db, COLLECTIONS.users, uid);

/** Live profile of one user (used by AuthContext). */
export function subscribeToUserProfile(uid, onData, onError) {
  return onSnapshot(
    userRef(uid),
    (snap) => onData(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  );
}

/** Live list of all users, newest first (administrators only). */
export function subscribeToUsers(onData, onError) {
  // No orderBy: Firestore would silently drop users without a createdAt field.
  return onSnapshot(
    collection(db, COLLECTIONS.users),
    (snap) => {
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      users.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
      onData(users);
    },
    onError,
  );
}

export async function updateUserProfile(uid, { nickname, phone }) {
  const cleanName = String(nickname ?? "").trim();
  const cleanPhone = String(phone ?? "").trim();
  if (cleanName.length > 100) throw new AppError("Name cannot exceed 100 characters.");
  if (cleanPhone.length > 30) throw new AppError("Phone number cannot exceed 30 characters.");
  await updateDoc(userRef(uid), { nickname: cleanName, phone: cleanPhone, updatedAt: serverTimestamp() });
}

export async function updateUserRole(uid, role) {
  if (!ALL_ROLES.includes(role)) throw new AppError("Invalid role.");
  await updateDoc(userRef(uid), {
    role,
    accountType: role === ROLES.CUSTOMER ? "customer" : "staff",
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserStatus(uid, status) {
  if (!Object.values(ACCOUNT_STATUS).includes(status)) throw new AppError("Invalid account status.");
  await updateDoc(userRef(uid), { status, updatedAt: serverTimestamp() });
}

/**
 * Creates a staff login through the SmartChip notifier (free Google Apps
 * Script, checks every minute), then emails the new person a link to choose
 * their own password.
 */
export async function createStaffAccount({ nickname, email, phone, role }) {
  if (!STAFF_ROLES.includes(role)) throw new AppError("Choose a staff role.");
  const job = await runJob(auth.currentUser.uid, "addStaff", {
    data: {
      nickname: String(nickname ?? "").trim(),
      email: String(email ?? "").trim().toLowerCase(),
      phone: String(phone ?? "").trim(),
      role,
    },
  });
  const data = job.result;

  let resetEmailSent = true;
  try {
    await sendPasswordResetEmail(auth, data.email);
  } catch (error) {
    console.error("Password setup email failed:", error);
    resetEmailSent = false;
  }
  return { ...data, resetEmailSent };
}

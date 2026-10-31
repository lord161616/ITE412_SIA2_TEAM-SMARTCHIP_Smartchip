import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { ACCOUNT_STATUS, COLLECTIONS, ROLES } from "../config/constants";
import { AppError } from "../lib/errors";
import { auth, db } from "../lib/firebase";

const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

/** Public sign-up. Always creates a *customer*; staff are added by an admin. */
export async function registerCustomer({ email, password, nickname, phone }) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(nickname ?? "").trim();
  if (!cleanEmail) throw new AppError("Email is required.");
  if (!password) throw new AppError("Password is required.");
  if (!cleanName) throw new AppError("Name is required.");

  const { user } = await createUserWithEmailAndPassword(auth, cleanEmail, password);

  try {
    await setDoc(doc(db, COLLECTIONS.users, user.uid), {
      uid: user.uid,
      email: user.email ?? cleanEmail,
      nickname: cleanName,
      phone: String(phone ?? "").trim(),
      role: ROLES.CUSTOMER,
      accountType: "customer",
      status: ACCOUNT_STATUS.ACTIVE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Don't leave a half-created, profile-less account signed in.
    await signOut(auth).catch(() => {});
    throw error;
  }
  return user;
}

export async function signIn(email, password) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new AppError("Email is required.");
  if (!password) throw new AppError("Password is required.");

  const { user } = await signInWithEmailAndPassword(auth, cleanEmail, password);

  // Best effort: powers the "Last login" column on the Users page.
  updateDoc(doc(db, COLLECTIONS.users, user.uid), { lastLoginAt: serverTimestamp() }).catch(
    () => {},
  );
  return user;
}

export function signOutUser() {
  return signOut(auth);
}

export function sendPasswordReset(email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new AppError("Enter your email address first.");
  return sendPasswordResetEmail(auth, cleanEmail);
}

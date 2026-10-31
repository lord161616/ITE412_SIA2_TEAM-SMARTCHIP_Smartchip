/** Turns Firebase / app errors into a sentence a person can act on. */

const AUTH_MESSAGES = {
  "auth/invalid-credential": "Invalid email or password.",
  "auth/wrong-password": "Invalid email or password.",
  "auth/user-not-found": "Invalid email or password.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Network connection failed. Check your internet connection.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/missing-password": "Please enter your password.",
};

const FIRESTORE_MESSAGES = {
  "permission-denied":
    "You don't have permission to do that. If you should, check your role or redeploy firestore.rules.",
  unavailable: "Can't reach Firebase right now. Check your internet connection.",
  aborted: "The data changed while saving. Please try again.",
  "not-found": "That record no longer exists.",
  "failed-precondition": "Firestore needs an index or a condition wasn't met. Check the browser console.",
  unauthenticated: "Please sign in again.",
};

export function getErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  const code = error.code || "";
  if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  if (code in FIRESTORE_MESSAGES) return FIRESTORE_MESSAGES[code] || error.message || fallback;
  const short = code.replace(/^firestore\//, "");
  if (FIRESTORE_MESSAGES[short]) return FIRESTORE_MESSAGES[short];
  return error.message || fallback;
}

/** Error thrown on purpose by our own checks (message is already user-friendly). */
export class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Requests for the SmartChip notifier (Google Apps Script, notifier/Code.gs).
 *
 * The free Firebase plan can't run Cloud Functions, so the web app writes a
 * small "job" document and the notifier, which checks every minute, does the
 * work with its own access and writes the result back. Used for "Send me a
 * test", "Connect Telegram" and "Add staff".
 */
import { addDoc, collection, deleteDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { AppError } from "../lib/errors";
import { db } from "../lib/firebase";

const jobsCol = collection(db, "jobs");

/** Creates a job and returns its reference without waiting. */
export function createJob(uid, type, fields = {}) {
  return addDoc(jobsCol, { type, uid, ...fields, status: "pending", createdAt: serverTimestamp() });
}

/**
 * Creates a job and waits for the notifier to finish it (it checks every
 * minute). Resolves with the finished job, or throws its error.
 */
export async function runJob(uid, type, fields = {}, { timeoutMs = 150_000 } = {}) {
  const ref = await createJob(uid, type, fields);
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      deleteDoc(ref).catch(() => {}); // don't let it run later by surprise
      reject(
        new AppError(
          "The notifier didn't answer within 2 minutes. Check it's running: Alerts → Sent notifications shows when it last checked.",
        ),
      );
    }, timeoutMs);
    unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const job = snap.data();
        if (!job || job.status === "pending") return;
        clearTimeout(timer);
        unsubscribe();
        deleteDoc(ref).catch(() => {});
        if (job.status === "done") resolve(job);
        else reject(new AppError(job.error || `The request ${job.status}.`));
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

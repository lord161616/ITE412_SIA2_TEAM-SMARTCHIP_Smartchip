/**
 * Notifications: settings, this device's push subscription, the send log.
 *
 * The sending itself is done by the SmartChip notifier, a free Google Apps
 * Script (notifier/Code.gs) that checks Firestore every minute and sends web
 * push, Gmail, Telegram (all free) and SMS through Semaphore (prepaid). This
 * file only reads/writes what the Alerts page needs.
 *
 * Who gets a channel = an admin gave it to them (settings.recipients)
 *                      AND they didn't switch it off (notifyPrefs/{uid}).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { deleteToken, getMessaging, getToken, isSupported } from "firebase/messaging";
import { COLLECTIONS } from "../config/constants";
import { AppError } from "../lib/errors";
import { app, db } from "../lib/firebase";
import { createJob, runJob } from "./jobService";

const settingsRef = doc(db, COLLECTIONS.settings, "notifications");

/**
 * Events and their default channels. Must match EVENTS in
 * functions/notify/rules.js (the functions apply the same defaults).
 */
export const NOTIFY_EVENTS = [
  { key: "fault", label: "Fault / over-temperature", hint: "Sensor failure, 80 °C cut-off, preheat timeout", web: true, email: true, sms: true, telegram: true },
  { key: "offline", label: "Offline during a run", hint: "No update for 3+ minutes while drying (checked every 5 min)", web: true, email: true, sms: true, telegram: true },
  { key: "runCompleted", label: "Drying complete", hint: "Reminder to weigh the batch", web: true, email: true, sms: true, telegram: true },
  { key: "runStartStop", label: "Run started / stopped", hint: "From the app or the machine's buttons", web: true, email: false, sms: false, telegram: false },
  { key: "newOrder", label: "New shop order", hint: "Operators and admins only", web: true, email: true, sms: false, telegram: true },
];
export const CHANNELS = [
  { key: "web", label: "Web", cost: "Free" },
  { key: "email", label: "Email", cost: "Free" },
  { key: "sms", label: "SMS", cost: "≈ ₱0.63 each" },
  { key: "telegram", label: "Telegram", cost: "Free" },
];
const CHANNEL_KEYS = CHANNELS.map((c) => c.key);
/** What a person gets from the admin until changed (free channels only). Matches rules.js. */
export const DEFAULT_RECIPIENT = Object.freeze({ web: true, email: false, sms: false, telegram: true });
/** A person's own switches: everything on until they turn it off. */
export const DEFAULT_PERSONAL = Object.freeze({ web: true, email: true, sms: true, telegram: true });
export const DEFAULT_SMS_LIMIT = 10;

const pickChannels = (c) => Object.fromEntries(CHANNEL_KEYS.map((k) => [k, Boolean(c?.[k])]));

export function defaultChannels() {
  return Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, pickChannels(e)]));
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function subscribeToNotifySettings(onData, onError) {
  return onSnapshot(
    settingsRef,
    (snap) => {
      const data = snap.data() ?? {};
      const channels = defaultChannels();
      for (const key of Object.keys(channels)) Object.assign(channels[key], data.channels?.[key] ?? {});
      onData({
        channels,
        recipients: data.recipients ?? {},
        smsDailyLimit: Number.isInteger(data.smsDailyLimit) ? data.smsDailyLimit : DEFAULT_SMS_LIMIT,
        exists: snap.exists(),
      });
    },
    onError,
  );
}

export async function saveNotifySettings({ channels, recipients, smsDailyLimit }, uid) {
  const limitValue = Number(smsDailyLimit);
  if (!Number.isInteger(limitValue) || limitValue < 0 || limitValue > 100) {
    throw new AppError("SMS daily limit must be a whole number from 0 to 100.");
  }
  const clean = pickChannels;
  await setDoc(settingsRef, {
    channels: Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, clean(channels[e.key])])),
    recipients: Object.fromEntries(Object.entries(recipients).map(([id, c]) => [id, clean(c)])),
    smsDailyLimit: limitValue,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/** Sends a sample to the signed-in person on the chosen channels (within about a minute). */
export async function sendTestNotification(uid, channels) {
  const job = await runJob(uid, "test", { channels });
  return { results: job.results ?? {}, errors: job.errors ?? [] };
}

/** When the notifier last ran, its Telegram bot and sending address. */
export function subscribeToNotifierStatus(onData, onError) {
  return onSnapshot(doc(db, "notifyState", "status"), (snap) => onData(snap.data() ?? null), onError);
}

/* ------------------------------------------------------------------ */
/* My own switches + Telegram                                          */
/* ------------------------------------------------------------------ */

const prefsRef = (uid) => doc(db, "notifyPrefs", uid);

/** A person's switches and Telegram connection (defaults if never saved). */
export function subscribeToMyPrefs(uid, onData, onError) {
  return onSnapshot(
    prefsRef(uid),
    (snap) => onData({ ...DEFAULT_PERSONAL, telegramChatId: null, telegramName: null, ...(snap.data() ?? {}) }),
    onError,
  );
}

/** Admins: everyone's switches, to show who turned what off / connected Telegram. */
export function subscribeToAllPrefs(onData, onError) {
  return onSnapshot(
    collection(db, "notifyPrefs"),
    (snap) => onData(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))),
    onError,
  );
}

/** Turn one of my channels on or off. */
export function setMyChannel(uid, channel, on) {
  if (!CHANNEL_KEYS.includes(channel)) throw new AppError("Unknown channel.");
  return setDoc(prefsRef(uid), { [channel]: Boolean(on), updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * A one-time t.me link: opening it and pressing Start connects Telegram.
 * The notifier reads the bot's messages every minute and matches the code.
 */
export async function getTelegramLink(uid) {
  const status = (await getDoc(doc(db, "notifyState", "status"))).data();
  const bot = status?.telegramBot;
  if (!bot) {
    throw new AppError("Telegram isn't set up yet. An admin needs to add the bot token to the notifier script and run setup.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const code = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await createJob(uid, "telegramLink", { code });
  return { url: `https://t.me/${bot}?start=${code}`, bot };
}

/** For groups or if the link can't be used: save a numeric chat ID by hand. */
export function setTelegramChatId(uid, chatId) {
  const id = String(chatId ?? "").trim();
  if (id && !/^-?\d{5,20}$/.test(id)) throw new AppError("A Telegram chat ID is a number, e.g. 123456789 (groups start with -).");
  return setDoc(
    prefsRef(uid),
    { telegramChatId: id || null, telegramName: id ? "Added by hand" : null, telegram: true, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export const disconnectTelegram = (uid) => setTelegramChatId(uid, "");

/** How many of my devices have web push on. */
export function subscribeToMyDevices(uid, onData, onError) {
  return onSnapshot(
    query(collection(db, "pushTokens"), where("uid", "==", uid)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

/* ------------------------------------------------------------------ */
/* Log + SMS usage                                                     */
/* ------------------------------------------------------------------ */

export function subscribeToNotificationLog(onData, onError) {
  return onSnapshot(
    query(collection(db, "notificationLog"), orderBy("createdAt", "desc"), limit(20)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export function subscribeToSmsUsage(onData, onError) {
  return onSnapshot(doc(db, "notifyState", "sms"), (snap) => onData(snap.data() ?? null), onError);
}

/* ------------------------------------------------------------------ */
/* This device (web push)                                              */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = "smartchip.pushToken";
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

function savedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function rememberToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the device still works, it just can't show "on" next time */
  }
}

/** "unsupported" | "blocked" | "off" | "on" */
export async function pushStatus() {
  if (!(await isSupported().catch(() => false)) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" && savedToken() ? "on" : "off";
}

/** Asks permission, subscribes this browser and saves its token for the functions. */
export async function enablePush(uid) {
  if (!VAPID_KEY) throw new AppError("Web push isn't set up yet: add VITE_FIREBASE_VAPID_KEY to .env (see SETUP.md).");
  if ((await pushStatus()) === "unsupported") {
    throw new AppError("This browser can't receive notifications. On iPhone, add SmartChip to the Home Screen first.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new AppError("Notifications were not allowed. You can allow them in the browser's site settings.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new AppError("Couldn't subscribe this device. Try again.");

  await setDoc(doc(db, "pushTokens", token), {
    uid,
    token,
    userAgent: navigator.userAgent.slice(0, 300),
    createdAt: serverTimestamp(),
  });
  rememberToken(token);
  return token;
}

export async function disablePush() {
  const token = savedToken();
  rememberToken(null);
  if (!token) return;
  await deleteDoc(doc(db, "pushTokens", token)).catch(() => {});
  await deleteToken(getMessaging(app)).catch(() => {});
}

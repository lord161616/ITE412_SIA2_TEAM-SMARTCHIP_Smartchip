/**
 * SmartChip shared settings: the ONE place for IDs, limits and status names.
 *
 * These values are a contract between this web app, firestore.rules and the
 * ESP32 firmware (firmware/smartchip_esp32/config.h). Full field list:
 * docs/DATA_MODEL.md. If you change one, change it in all of them.
 */

/* ---------- Device ---------- */

export const DEVICE_ID = "SMARTCHIP-ESP32-01";

/** The ESP32 sends a heartbeat every 10 s; no heartbeat for this long = offline. */
export const DEVICE_OFFLINE_AFTER_MS = 45_000;

/** Firestore rules allow "Recover machine" after this much silence. */
export const RECOVERY_AFTER_MS = 120_000;

/** A command the ESP32 hasn't handled within this time gets a warning. */
export const COMMAND_SLOW_MS = 20_000;

/* ---------- Drying limits (must match firestore.rules + firmware) ---------- */

export const TEMP_LIMITS = Object.freeze({
  min: 30,
  max: 75,
  default: 55,
  /** ESP32 cuts power at this temperature. Never selectable as a target. */
  hardSafety: 80,
});

export const DURATION_LIMITS = Object.freeze({
  minMinutes: 1,
  maxMinutes: 720, // 12 h
});

/* ---------- Firestore collection names ---------- */

export const COLLECTIONS = Object.freeze({
  users: "users",
  devices: "devices",
  dryingRuns: "dryingRuns",
  inventory: "inventory",
  products: "products",
  reservations: "reservations",
  shop: "shop",
  settings: "settings",
});

/* ---------- devices/{id}.status (written by the ESP32) ---------- */

export const MACHINE = Object.freeze({
  IDLE: "idle",
  SETUP: "setup", // someone is using the LCD menu
  PREHEATING: "preheating",
  DRYING: "drying",
  COMPLETED: "completed",
  FAULT: "fault",
});

/** Machine states in which a new run can be started. */
export const READY_STATUSES = [MACHINE.IDLE, MACHINE.COMPLETED];
export const RUNNING_STATUSES = [MACHINE.PREHEATING, MACHINE.DRYING];

/** States the app adds on top of status (never written to Firestore). */
export const CONNECTION = Object.freeze({
  LOADING: "loading",
  MISSING: "missing", // device document doesn't exist yet
  OFFLINE: "offline",
  ONLINE: "online",
  ERROR: "error",
});

/* ---------- devices/{id}.command (written by the web app) ---------- */

export const COMMANDS = Object.freeze({
  START: "START",
  STOP: "STOP",
  CLEAR_FAULT: "CLEAR_FAULT",
});

/* ---------- dryingRuns/{id}.status ---------- */

export const RUN = Object.freeze({
  PENDING: "pending", // START sent, ESP32 hasn't accepted yet
  PREHEATING: "preheating",
  DRYING: "drying",
  COMPLETED: "completed",
  STOPPED: "stopped",
  FAILED: "failed",
});

export const ACTIVE_RUN_STATUSES = [RUN.PENDING, RUN.PREHEATING, RUN.DRYING];
export const FINISHED_RUN_STATUSES = [RUN.COMPLETED, RUN.STOPPED, RUN.FAILED];

export const END_REASONS = Object.freeze({
  completed: "Completed",
  stopped_web: "Stopped from the app",
  stopped_button: "Stopped with the STOP button",
  fault: "Stopped by a fault",
  power_loss: "Power loss / ESP32 restarted",
  rejected: "Rejected by the ESP32",
  expired: "START arrived too late",
  cancelled: "Cancelled before it started",
  recovered: "Cleared by offline recovery",
});

/* ---------- inventory/{id}.status ---------- */

export const BATCH = Object.freeze({
  FRESH: "Fresh",
  DRYING: "Drying",
  DRIED: "Dried",
  ARCHIVED: "Archived",
});

export const BATCH_STATUSES = Object.values(BATCH);

/** Yield badge colours on History (dried kg / fresh kg). Change to suit your mushrooms. */
export const YIELD_THRESHOLDS = Object.freeze({
  good: 20, // >= this % is green
  fair: 15, // >= this % is amber, below is red
});

/* ---------- Users ---------- */

export const ROLES = Object.freeze({
  CUSTOMER: "customer",
  VIEWER: "viewer",
  OPERATOR: "operator",
  ADMIN: "administrator",
});

export const ALL_ROLES = Object.values(ROLES);
export const STAFF_ROLES = [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN];
export const OPERATOR_ROLES = [ROLES.OPERATOR, ROLES.ADMIN];
export const ADMIN_ROLES = [ROLES.ADMIN];

export const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
  PENDING: "pending",
});

/* ---------- Codes the ESP32 reports ---------- */

export const FAULT_MESSAGES = Object.freeze({
  SENSOR_1_FAILURE: "SHT31 sensor #1 stopped giving readings.",
  SENSOR_2_FAILURE: "SHT31 sensor #2 stopped giving readings.",
  SENSOR_FAILURE: "Both SHT31 sensors stopped giving readings.",
  OVER_TEMPERATURE: `A sensor reached the ${TEMP_LIMITS.hardSafety} °C safety limit. Heater was cut.`,
  PREHEAT_TIMEOUT: "The chamber didn't reach the target temperature in time. Check the heater, fan and door.",
  DEVICE_ERROR: "The controller reported an internal error.",
});

export const REJECT_MESSAGES = Object.freeze({
  BUSY: "the machine is already running",
  LOCAL_MENU: "someone is using the menu on the machine",
  SENSORS_NOT_READY: "the sensors aren't giving readings",
  FAULT_ACTIVE: "the machine is in fault",
  EXPIRED: "the command arrived too late (device was offline)",
  NOT_RUNNING: "nothing is running",
  INVALID: "the settings were invalid",
  STILL_OVER_TEMPERATURE: "the chamber is still over the safety temperature",
});

/* ---------- Shop (must match firestore.rules) ---------- */

export const RESERVATION = Object.freeze({
  RESERVED: "reserved", // stock held, being prepared
  READY: "ready", // ready for pickup
  COMPLETED: "completed", // collected
  CANCELLED: "cancelled",
});

export const PAYMENT = Object.freeze({
  UNPAID: "unpaid",
  SUBMITTED: "submitted", // customer entered a GCash reference
  VERIFIED: "verified", // shop manager confirmed the money arrived
  REJECTED: "rejected", // reference didn't match; customer can resubmit
});

/** New orders are GCash only (pay first). "cash" is kept to display older orders. */
export const PAYMENT_METHODS = Object.freeze({
  gcash: "GCash",
  cash: "Cash on pickup",
});

export const SHOP_LIMITS = Object.freeze({
  maxPackages: 4,
  minPackageGrams: 10,
  maxQuantity: 50,
  /** Orders whose payment wasn't found are flagged after this long, so the stock can be released. */
  unpaidFlagHours: 24,
});

/**
 * =====================================================================
 * SmartChip notifier: Google Apps Script (free, no Firebase Blaze plan)
 * =====================================================================
 *
 * Runs on Google's servers every minute under your Google account and:
 *   - watches Firestore for faults, finished runs, new shop orders and the
 *     dehydrator going quiet during a run
 *   - sends web push (Firebase Cloud Messaging), email (your Gmail),
 *     Telegram (your bot) and SMS (Semaphore, prepaid), following the
 *     settings on the SmartChip Alerts page
 *   - handles "Send me a test", "Connect Telegram" and "Add staff"
 *
 * Only SMS costs money (Semaphore credits). Everything else is free.
 *
 * SETUP (full steps in SETUP.md, section 7):
 *   1. script.google.com -> New project, signed in with the Google account
 *      that OWNS the Firebase project. Paste this file over Code.gs.
 *   2. Project Settings -> tick "Show appsscript.json" -> paste
 *      notifier/appsscript.json over it.
 *   3. Fill in CONFIG below.
 *   4. Pick "setup" in the function list -> Run -> allow access.
 *      (Google warns the app isn't verified because it's your own script:
 *      Advanced -> Go to SmartChip notifier.)
 *   Done. It checks every minute from now on. Run "stopNotifier" to stop.
 *
 * Emails are sent from the Google account that runs this script.
 */

// ===================== FILL THESE IN =====================
var CONFIG = {
  PROJECT_ID: "smartchip-client-16036",
  APP_URL: "", // your website, e.g. "https://smartchip.vercel.app" (used for links in emails and Telegram)
  TELEGRAM_BOT_TOKEN: "", // from @BotFather, or "" to leave Telegram off
  SEMAPHORE_API_KEY: "", // from semaphore.co, or "" to leave SMS off
  SEMAPHORE_SENDER: "", // your approved sender name, e.g. "SMARTCHIP" ("" = Semaphore's default)
  EMAIL_NAME: "SmartChip",
};
// ==========================================================

var DEVICE_ID = "SMARTCHIP-ESP32-01";
var OFFLINE_AFTER_MS = 3 * 60 * 1000; // silent this long during a run = offline
var LOW_CREDIT_WARNING = 20; // warn admins below this many Semaphore credits
var LINK_MAX_AGE_MS = 30 * 60 * 1000; // "Connect Telegram" links work this long
var TELEGRAM_IDLE_CHECK_MS = 15 * 60 * 1000; // read /stop messages this often
var STATUS_EVERY_MS = 4 * 60 * 1000; // "notifier last checked" heartbeat
var DEFAULT_SMS_DAILY_LIMIT = 10;
var MAX_SMS_DAILY_LIMIT = 100;

/* =====================================================================
 * Events and channels (same defaults as the Alerts page)
 * ===================================================================== */

var CHANNELS = ["web", "email", "sms", "telegram"];

var EVENTS = {
  fault: { web: true, email: true, sms: true, telegram: true },
  offline: { web: true, email: true, sms: true, telegram: true },
  runCompleted: { web: true, email: true, sms: true, telegram: true },
  runStartStop: { web: true, email: false, sms: false, telegram: false },
  newOrder: { web: true, email: true, sms: false, telegram: true, shopOnly: true },
};

/** What an admin gives a person until changed: the free channels. */
var DEFAULT_RECIPIENT = { web: true, email: false, sms: false, telegram: true };
/** A person's own switches: everything on until they turn it off. */
var DEFAULT_PERSONAL = { web: true, email: true, sms: true, telegram: true };

var STAFF_ROLES = ["viewer", "operator", "administrator"];
var SHOP_ROLES = ["operator", "administrator"];

var FAULT_TEXT = {
  SENSOR_1_FAILURE: "SHT31 sensor #1 stopped giving readings.",
  SENSOR_2_FAILURE: "SHT31 sensor #2 stopped giving readings.",
  SENSOR_FAILURE: "Both SHT31 sensors stopped giving readings.",
  OVER_TEMPERATURE: "A sensor reached the 80 °C safety limit.",
  PREHEAT_TIMEOUT: "The chamber didn't reach the target in time. Check the heater, fan and door.",
  DEVICE_ERROR: "The controller reported an internal error.",
};

var END_REASONS = {
  stopped_web: "from the app",
  stopped_button: "with the STOP button",
  power_loss: "because the dehydrator lost power or restarted",
  rejected: "because the dehydrator refused the START",
  expired: "because the START arrived too late",
  recovered: "by offline recovery",
};

var EMOJI = {
  fault: "🚨", offline: "📴", runCompleted: "✅", runStartStop: "🔄",
  newOrder: "🛒", test: "👋", lowCredits: "💳",
};

/* =====================================================================
 * Entry points (run these from the editor)
 * ===================================================================== */

/** One-time setup: checks access, prepares Telegram, starts the 1-minute timer. */
function setup() {
  checkConfig_();
  Logger.log("Checking Firestore access for project " + CONFIG.PROJECT_ID + " ...");
  fsGet_("devices/" + DEVICE_ID); // throws a clear error if access is missing

  var status = { lastPollAt: new Date(), version: 1, telegramBot: null, emailFrom: Session.getEffectiveUser().getEmail() };
  if (CONFIG.TELEGRAM_BOT_TOKEN) {
    var me = telegram_("getMe", {});
    if (!me.ok) throw new Error("TELEGRAM_BOT_TOKEN doesn't work: " + (me.description || "check it in @BotFather"));
    telegram_("deleteWebhook", { drop_pending_updates: false }); // this script reads messages itself
    status.telegramBot = me.result.username;
    Logger.log("Telegram bot: @" + status.telegramBot);
  }
  fsSet_("notifyState/status", status);

  // Start from now (don't send alerts for old events, even after a long stop).
  var state = loadState_();
  state.cursorRuns = new Date().toISOString();
  state.cursorOrders = new Date().toISOString();
  saveState_(state);

  stopNotifier();
  ScriptApp.newTrigger("poll").timeBased().everyMinutes(1).create();
  Logger.log("Done. The notifier checks every minute. Emails are sent from " + status.emailFrom + ".");
}

/** Stops the 1-minute timer. Run setup again to restart. */
function stopNotifier() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "poll") ScriptApp.deleteTrigger(t);
  });
}

/** Sends a test to every channel to the person running this (email always; others if set up). */
function sendTestToMe() {
  var email = Session.getEffectiveUser().getEmail();
  var users = fsQuery_("users", [["email", "EQUAL", email]]);
  if (users.length === 0) throw new Error("No SmartChip user with email " + email + ". Sign in to the web app with it first.");
  var result = dispatch_(new Ctx_(), {
    event: "test",
    title: "Test notification",
    body: "Notifications are working. You'll get alerts like this for the dehydrator and the shop.",
    sms: "SmartChip: this is a sample alert. Text notifications are working.",
    url: "/notifications",
  }, { only: [users[0].id], channels: CHANNELS });
  Logger.log(JSON.stringify(result));
}

/** The timer calls this every minute. */
function poll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return; // the previous run is still going
  try {
    pollOnce_();
  } finally {
    lock.releaseLock();
  }
}

/* =====================================================================
 * The check that runs every minute
 * ===================================================================== */

function pollOnce_() {
  var now = Date.now();
  var docs = fsBatchGet_(["devices/" + DEVICE_ID, "notifyState/notifier", "notifyState/status"]);
  var device = docs[0];
  var state = docs[1] && docs[1].json ? JSON.parse(docs[1].json) : {};
  var status = docs[2] || {};
  var before = JSON.stringify(state);
  var ctx = new Ctx_();
  var nowIso = new Date(now).toISOString();
  state.cursorRuns = state.cursorRuns || nowIso;
  state.cursorOrders = state.cursorOrders || nowIso;
  state.runs = state.runs || {};

  // 1. New fault on the dehydrator.
  if (device) {
    var code = device.faultCode;
    if (hasFault_(code) && code !== state.faultCode) {
      dispatch_(ctx, faultMessage_(code));
      state.faultAlertedAt = now;
    }
    state.faultCode = hasFault_(code) ? code : null;
  }

  // 2. Drying runs that changed since the last check.
  // Cursors are Firestore's own timestamp strings (microseconds), so nothing is seen twice.
  var runs = fsQuery_("dryingRuns", [["updatedAt", "GREATER_THAN", ts_(state.cursorRuns)]], "updatedAt", 50);
  runs.forEach(function (run) {
    runMessages_(run, state).forEach(function (m) {
      dispatch_(ctx, m);
    });
    if (run.updatedAt) state.cursorRuns = maxIso_(state.cursorRuns, run.updatedAt);
  });
  pruneRuns_(state, now);

  // 3. New shop orders.
  var orders = fsQuery_("reservations", [["createdAt", "GREATER_THAN", ts_(state.cursorOrders)]], "createdAt", 50);
  orders.forEach(function (r) {
    dispatch_(ctx, orderMessage_(r, "R-" + r.id.slice(0, 6).toUpperCase()));
    if (r.createdAt) state.cursorOrders = maxIso_(state.cursorOrders, r.createdAt);
  });

  // 4. Dehydrator silent during a run.
  if (device) checkOffline_(ctx, device, state, now);

  // 5. Requests from the web app: tests, Telegram links, new staff.
  var jobs = fsQuery_("jobs", [["status", "EQUAL", "pending"]], null, 20);
  var links = [];
  jobs.forEach(function (job) {
    try {
      if (job.type === "test") runTestJob_(ctx, job);
      else if (job.type === "addStaff") runAddStaffJob_(job);
      else if (job.type === "telegramLink") {
        if (now - toMs_(job.createdAt) > LINK_MAX_AGE_MS) fsSet_("jobs/" + job.id, { status: "expired", doneAt: new Date() }, true);
        else links.push(job);
      }
    } catch (error) {
      fsSet_("jobs/" + job.id, { status: "error", error: String(error.message || error).slice(0, 300), doneAt: new Date() }, true);
    }
  });

  // 6. Telegram: "/start CODE" from a link, or "/stop".
  if (CONFIG.TELEGRAM_BOT_TOKEN && (links.length > 0 || now - (state.tgCheckedAt || 0) > TELEGRAM_IDLE_CHECK_MS)) {
    readTelegram_(links, state);
    state.tgCheckedAt = now;
  }

  if (JSON.stringify(state) !== before) saveState_(state);
  if (now - toMs_(status.lastPollAt) > STATUS_EVERY_MS) {
    fsSet_("notifyState/status", { lastPollAt: new Date(now) }, true);
  }
}

/* =====================================================================
 * Recognising events
 * ===================================================================== */

function hasFault_(code) {
  return Boolean(code) && code !== "NONE";
}

function faultMessage_(code) {
  var text = FAULT_TEXT[code] || "The controller reported a fault.";
  return {
    event: "fault",
    title: "Machine fault: " + code,
    body: text + " The heater is off. Check the dehydrator, then use Clear fault on the Dashboard.",
    sms: "SmartChip FAULT " + code + ": " + text + " Check the machine.",
    tag: "fault-" + code,
    url: "/dashboard",
  };
}

function hoursText_(minutes) {
  var m = Math.round(Number(minutes) || 0);
  if (m <= 0) return "";
  var h = Math.floor(m / 60);
  return h ? h + " h" + (m % 60 ? " " + (m % 60) + " m" : "") : m + " m";
}

/**
 * Messages for one run that changed. We don't see the "before" state, so
 * state.runs remembers which messages each run already produced.
 */
function runMessages_(run, state) {
  var sent = state.runs[run.id] || { at: Date.now() };
  state.runs[run.id] = sent;
  var batch = run.batchNumber ? " (batch " + run.batchNumber + ")" : "";
  var tag = "run-" + (run.batchNumber || "local");
  var out = [];

  if (["preheating", "drying"].indexOf(run.status) >= 0 && !sent.start) {
    sent.start = true;
    var t = run.targetTemp ? Math.round(run.targetTemp) + " °C" : "";
    var d = hoursText_(run.durationMinutes);
    out.push({
      event: "runStartStop",
      title: "Drying started" + batch,
      body: "Preheating to " + t + (d ? " for " + d : "") + (run.source === "local" ? ", started with the machine's buttons" : "") + ".",
      sms: "SmartChip: drying started" + batch + ", " + t + " " + d + ".",
      tag: tag,
      url: "/dashboard",
    });
  }

  if (sent.end) return out;
  if (run.status === "completed") {
    sent.end = true;
    out.push({
      event: "runCompleted",
      title: "Drying complete" + batch,
      body: "The run finished. Weigh the dried batch and record the dried weight in Inventory.",
      sms: "SmartChip: drying complete" + batch + ". Weigh it and record it in Inventory.",
      tag: tag,
      url: "/inventory",
    });
  } else if (run.status === "stopped" || run.status === "failed") {
    sent.end = true;
    if (run.endReason === "cancelled") return out;
    if (run.endReason === "fault") {
      // Normally already sent from the device's faultCode; send it here only
      // if the fault came and went between two checks.
      if (hasFault_(run.faultCode) && run.faultCode !== state.faultCode &&
          Date.now() - (state.faultAlertedAt || 0) > 10 * 60 * 1000) {
        state.faultAlertedAt = Date.now();
        out.push(faultMessage_(run.faultCode));
      }
      return out;
    }
    var how = END_REASONS[run.endReason] || "";
    var verb = run.status === "stopped" ? "stopped" : "ended early";
    out.push({
      event: "runStartStop",
      title: "Drying " + verb + batch,
      body: "The run " + verb + (how ? " " + how : "") + ". The batch is back to Fresh.",
      sms: "SmartChip: run " + verb + batch + (how ? " " + how : "") + ".",
      tag: tag,
      url: "/history",
    });
  }
  return out;
}

/** Forget runs we haven't heard about for 3 days. */
function pruneRuns_(state, now) {
  Object.keys(state.runs).forEach(function (id) {
    if (now - (state.runs[id].at || 0) > 3 * 86400000) delete state.runs[id];
  });
}

function orderMessage_(r, code) {
  var peso = "₱" + Number(r.total || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
  var qty = (r.quantity + " × " + r.packageGrams + " g " + (r.productName || "")).trim();
  var ref = r.paymentReference ? " GCash ref " + r.paymentReference + "." : "";
  return {
    event: "newOrder",
    title: "New order " + code + " from " + (r.customerName || "a customer"),
    body: qty + ", " + peso + "." + ref + " Verify the payment in Shop → Manage shop.",
    sms: "SmartChip order " + code + ": " + qty + ", " + peso + "." + ref,
    tag: "order-" + code,
    url: "/shop?tab=manage",
  };
}

function isRunning_(device) {
  return Boolean(device && (device.runId || ["preheating", "drying"].indexOf(device.status) >= 0));
}

function checkOffline_(ctx, device, state, now) {
  var lastSeen = toMs_(device.lastSeen);
  var offline = !lastSeen || now - lastSeen > OFFLINE_AFTER_MS;
  var batch = "";
  if (offline && isRunning_(device) && !state.offlineAlertedAt) {
    if (device.runId) {
      var run = fsGet_("dryingRuns/" + device.runId);
      if (run && run.batchNumber) batch = " (batch " + run.batchNumber + ")";
    }
    var minutes = Math.round((now - lastSeen) / 60000);
    state.offlineAlertedAt = now;
    state.offlineRunId = device.runId || null;
    dispatch_(ctx, {
      event: "offline",
      title: "Dehydrator offline during a run" + batch,
      body: "No update from the dehydrator for " + minutes + " minutes while drying. Check its power and Wi-Fi. " +
        "If it restarted, the run will show as failed and the batch goes back to Fresh.",
      sms: "SmartChip OFFLINE during a run" + batch + ", no update for " + minutes + " min. Check power and Wi-Fi.",
      tag: "offline",
      url: "/dashboard",
    });
  } else if (!offline && state.offlineAlertedAt) {
    var stillRunning = device.runId === state.offlineRunId && isRunning_(device);
    state.offlineAlertedAt = null;
    state.offlineRunId = null;
    dispatch_(ctx, {
      event: "offline",
      title: "Dehydrator back online",
      body: stillRunning ? "It's reporting again and the run is still going." :
        "It's reporting again. If it restarted, check History: the interrupted run is marked failed.",
      sms: "",
      tag: "offline",
      url: "/dashboard",
    }, { skipSms: true }); // good news never costs a text
  }
}

/* =====================================================================
 * Jobs from the web app
 * ===================================================================== */

function runTestJob_(ctx, job) {
  var channels = (job.channels || []).filter(function (c) { return CHANNELS.indexOf(c) >= 0; });
  var log = dispatch_(ctx, {
    event: "test",
    title: "Test notification",
    body: "Notifications are working. You'll get alerts like this for the dehydrator and the shop.",
    sms: "SmartChip: this is a sample alert. Text notifications are working.",
    tag: "test",
    url: "/notifications",
  }, { only: [job.uid], channels: channels });
  fsSet_("jobs/" + job.id, { status: "done", results: log.results, errors: log.errors, doneAt: new Date() }, true);
}

/** Creates a staff login (no password: the web app emails a set-password link). */
function runAddStaffJob_(job) {
  var requester = fsGet_("users/" + job.uid);
  if (!requester || requester.role !== "administrator" || requester.status !== "active") {
    throw new Error("Only active administrators can create staff accounts.");
  }
  var d = job.data || {};
  var nickname = String(d.nickname || "").trim().slice(0, 100);
  var email = String(d.email || "").trim().toLowerCase();
  var phone = String(d.phone || "").trim().slice(0, 30);
  var role = d.role;
  if (!nickname) throw new Error("Name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please provide a valid email address.");
  if (STAFF_ROLES.indexOf(role) < 0) throw new Error("Invalid staff role.");

  var res = api_("post", "https://identitytoolkit.googleapis.com/v1/projects/" + CONFIG.PROJECT_ID + "/accounts",
      { email: email, displayName: nickname, emailVerified: false, disabled: false }, [400]);
  if (res.code === 400) {
    var why = (res.json.error && res.json.error.message) || "";
    throw new Error(why.indexOf("EMAIL_EXISTS") >= 0 ? "An account with this email address already exists." : "Couldn't create the login: " + why);
  }
  var uid = res.json.localId;
  var now = new Date();
  try {
    fsSet_("users/" + uid, {
      uid: uid, nickname: nickname, email: email, phone: phone, role: role,
      accountType: "staff", status: "active", createdAt: now, updatedAt: now,
    });
  } catch (error) {
    // Don't leave a login without a profile.
    api_("post", "https://identitytoolkit.googleapis.com/v1/projects/" + CONFIG.PROJECT_ID + "/accounts:delete", { localId: uid }, [400, 404]);
    throw error;
  }
  fsSet_("jobs/" + job.id, { status: "done", result: { uid: uid, email: email, role: role }, doneAt: now }, true);
}

/* =====================================================================
 * Telegram linking (reads the bot's messages; no webhook needed)
 * ===================================================================== */

function readTelegram_(links, state) {
  var res = telegram_("getUpdates", { offset: state.tgOffset || 0, timeout: 0, allowed_updates: ["message"] });
  if (!res.ok) return;
  res.result.forEach(function (update) {
    state.tgOffset = update.update_id + 1;
    var msg = update.message;
    if (!msg || !msg.chat || typeof msg.text !== "string") return;
    var chatId = String(msg.chat.id);
    var parts = msg.text.trim().split(/\s+/);
    var reply = function (text) { telegram_("sendMessage", { chat_id: chatId, text: text }); };

    if (parts[0] === "/start" && parts[1]) {
      var job = links.filter(function (j) { return j.code === parts[1]; })[0];
      if (!job) {
        reply("This link has expired. Open SmartChip → Alerts and press Connect Telegram again.");
        return;
      }
      var from = msg.from || {};
      var name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "Telegram";
      fsSet_("notifyPrefs/" + job.uid, {
        telegram: true, telegramChatId: chatId, telegramName: name.slice(0, 80), updatedAt: new Date(),
      }, true);
      fsSet_("jobs/" + job.id, { status: "done", doneAt: new Date() }, true);
      reply("✅ Connected! You'll get SmartChip alerts here. Turn them off any time on the Alerts page, or send /stop.");
    } else if (parts[0] === "/stop") {
      fsQuery_("notifyPrefs", [["telegramChatId", "EQUAL", chatId]]).forEach(function (p) {
        fsSet_("notifyPrefs/" + p.id, { telegramChatId: null, telegramName: null, updatedAt: new Date() }, true);
      });
      reply("Disconnected. You won't get SmartChip alerts here any more.");
    } else {
      reply("Hi! This bot sends SmartChip alerts. To connect, open SmartChip → Alerts and press Connect Telegram. Send /stop to disconnect.");
    }
  });
}

function telegram_(method, body) {
  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  try {
    var json = JSON.parse(res.getContentText());
    json.httpCode = res.getResponseCode();
    return json;
  } catch (e) {
    return { ok: false, httpCode: res.getResponseCode(), description: "bad response" };
  }
}

/* =====================================================================
 * Sending
 * ===================================================================== */

/** Lazily loaded data shared by all sends in one check. */
function Ctx_() {
  var cache = {};
  this.settings = function () {
    if (!cache.settings) cache.settings = resolveSettings_(fsGet_("settings/notifications"));
    return cache.settings;
  };
  this.staff = function () {
    if (!cache.staff) {
      var rank = { administrator: 0, operator: 1, viewer: 2 };
      cache.staff = fsQuery_("users", [["accountType", "EQUAL", "staff"]])
          .filter(function (u) { return u.status === "active" && STAFF_ROLES.indexOf(u.role) >= 0; })
          .sort(function (a, b) { return rank[a.role] - rank[b.role]; });
    }
    return cache.staff;
  };
  this.prefs = function () {
    if (!cache.prefs) {
      cache.prefs = {};
      fsList_("notifyPrefs").forEach(function (p) { cache.prefs[p.id] = p; });
    }
    return cache.prefs;
  };
  this.tokens = function () {
    if (!cache.tokens) cache.tokens = fsList_("pushTokens");
    return cache.tokens;
  };
}

function resolveSettings_(saved) {
  var s = saved || {};
  var channels = {};
  Object.keys(EVENTS).forEach(function (key) {
    var savedEvent = (s.channels && s.channels[key]) || {};
    channels[key] = {};
    CHANNELS.forEach(function (ch) {
      channels[key][ch] = typeof savedEvent[ch] === "boolean" ? savedEvent[ch] : EVENTS[key][ch];
    });
  });
  var limit = Number(s.smsDailyLimit);
  return {
    channels: channels,
    recipients: s.recipients || {},
    smsDailyLimit: Number.isInteger(limit) && limit >= 0 && limit <= MAX_SMS_DAILY_LIMIT ? limit : DEFAULT_SMS_DAILY_LIMIT,
  };
}

/** Admin gave it to them AND they didn't switch it off. */
function personGets_(settings, prefs, uid, channel) {
  var given = Object.assign({}, DEFAULT_RECIPIENT, settings.recipients[uid] || {});
  var personal = Object.assign({}, DEFAULT_PERSONAL, prefs || {});
  return Boolean(given[channel] && personal[channel] !== false);
}

/**
 * message: {event, title, body, sms, url, tag}
 * options.only:     [uid] send to just these people (test)
 * options.channels: which channels (test)
 * options.skipSms:  never text this one
 */
function dispatch_(ctx, message, options) {
  options = options || {};
  var settings = ctx.settings();
  var eventChannels = options.channels ?
    CHANNELS.reduce(function (o, c) { o[c] = options.channels.indexOf(c) >= 0; return o; }, {}) :
    settings.channels[message.event];
  var def = EVENTS[message.event] || {};
  var roles = def.shopOnly ? SHOP_ROLES : STAFF_ROLES;
  var staff = ctx.staff().filter(function (u) {
    return roles.indexOf(u.role) >= 0 && (!options.only || options.only.indexOf(u.id) >= 0);
  });
  var prefs = ctx.prefs();
  var pick = function (channel) {
    return staff.filter(function (u) {
      return eventChannels[channel] && (options.only || personGets_(settings, prefs[u.id], u.id, channel));
    });
  };

  var log = { event: message.event, title: message.title, body: message.body, results: {}, errors: [] };
  var jobs = {
    web: function () { return sendWeb_(ctx, pick("web").map(function (u) { return u.id; }), message); },
    email: function () { return sendEmail_(pick("email").map(function (u) { return u.email; }).filter(Boolean), message); },
    sms: function () { return sendSmsTo_(pick("sms"), message, settings); },
    telegram: function () { return sendTelegramTo_(pick("telegram"), prefs, message, Boolean(options.only)); },
  };
  CHANNELS.forEach(function (channel) {
    if (!eventChannels[channel] || (channel === "sms" && options.skipSms)) return;
    try {
      log.results[channel] = jobs[channel]();
    } catch (error) {
      log.results[channel] = { sent: 0 };
      log.errors.push((channel + ": " + (error.message || error)).slice(0, 300));
    }
  });

  fsAdd_("notificationLog", {
    event: log.event, title: log.title, body: log.body, results: log.results, errors: log.errors,
    test: Boolean(options.only), createdAt: new Date(),
  });
  warnLowCredits_(ctx);
  return log;
}

function appUrl_(path) {
  // No website address yet: messages simply go without a link.
  if (!/^https?:\/\//.test(CONFIG.APP_URL || "")) return "";
  return CONFIG.APP_URL.replace(/\/$/, "") + (path || "/");
}

/* ---------- Web push (Firebase Cloud Messaging, free) ---------- */

function sendWeb_(ctx, uids, message) {
  if (uids.length === 0) return { sent: 0 };
  var tokens = ctx.tokens().filter(function (t) { return uids.indexOf(t.uid) >= 0; });
  if (tokens.length === 0) return { sent: 0, note: "nobody has turned on notifications on a device yet" };

  var url = "https://fcm.googleapis.com/v1/projects/" + CONFIG.PROJECT_ID + "/messages:send";
  var requests = tokens.map(function (t) {
    return authRequest_("post", url, {
      message: {
        token: t.token,
        data: {
          title: "SmartChip: " + message.title,
          body: message.body,
          url: message.url || "/notifications",
          tag: message.tag || message.event,
        },
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
      },
    });
  });
  var sent = 0;
  var failed = 0;
  UrlFetchApp.fetchAll(requests).forEach(function (res, i) {
    var code = res.getResponseCode();
    if (code === 200) {
      sent++;
      return;
    }
    failed++;
    var text = res.getContentText();
    // Uninstalled / blocked: forget the device.
    if (code === 404 || (code === 400 && text.indexOf("registration token") >= 0) || text.indexOf("UNREGISTERED") >= 0) {
      fsDelete_("pushTokens/" + tokens[i].id);
    } else if (failed === 1) {
      throw new Error("FCM " + code + ": " + text.slice(0, 200));
    }
  });
  return { sent: sent, failed: failed };
}

/* ---------- Email (your Gmail, free; ~100 recipients a day) ---------- */

function sendEmail_(addresses, message) {
  if (addresses.length === 0) return { sent: 0 };
  var left = MailApp.getRemainingDailyQuota();
  if (left < addresses.length + 1) return { sent: 0, note: "Gmail's daily email limit is used up (resets tomorrow)" };
  var link = appUrl_(message.url || "/notifications");
  var footer = "You get this because you're on the SmartChip notification list (Alerts page).";
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    bcc: addresses.join(","),
    subject: "SmartChip: " + message.title,
    name: CONFIG.EMAIL_NAME,
    body: message.body + (link ? "\n\nOpen SmartChip: " + link : "") + "\n\n" + footer,
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a">' +
      '<h2 style="font-size:18px;margin:0 0 8px">' + escapeHtml_(message.title) + "</h2>" +
      '<p style="margin:0 0 16px">' + escapeHtml_(message.body) + "</p>" +
      (link ? '<p><a href="' + link + '" style="background:#4053d6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open SmartChip</a></p>' : "") +
      '<p style="color:#64748b;font-size:12px">' + footer + "</p></div>",
  });
  return { sent: addresses.length };
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

/* ---------- SMS (Semaphore, prepaid) ---------- */

/** "0917 123 4567" / "+63 917…" / "9171234567" -> "09171234567", or null. */
function normalizePhone_(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^639\d{9}$/.test(digits)) return "0" + digits.slice(2);
  if (/^9\d{9}$/.test(digits)) return "0" + digits;
  return null;
}

/**
 * 1 credit per text: plain characters only (one fancy character makes the
 * whole text Unicode, which halves the length per credit), at most 160, and
 * never starting with "TEST" (Semaphore silently drops those).
 */
function smsText_(text) {
  var s = String(text || "")
      .replace(/°\s?C/g, "C").replace(/[·•–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/₱/g, "P").replace(/…/g, "...").replace(/×/g, "x").replace(/→/g, ">")
      .replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  if (/^test/i.test(s)) s = "SmartChip " + s;
  if (s.length > 160) s = s.slice(0, 157).trim() + "...";
  return s;
}

/** Calendar day in the Philippines, e.g. "2026-10-31" (for the daily cap). */
function manilaDay_(date) {
  return Utilities.formatDate(date || new Date(), "Asia/Manila", "yyyy-MM-dd");
}

function sendSmsTo_(people, message, settings) {
  if (people.length === 0) return { sent: 0 };
  var numbers = [];
  people.forEach(function (u) {
    var n = normalizePhone_(u.phone);
    if (n && numbers.indexOf(n) < 0) numbers.push(n);
  });
  var missing = people.length - numbers.length;
  var note = missing > 0 ? missing + " without a valid PH mobile number" : "";
  if (numbers.length === 0) return { sent: 0, note: note };
  if (!CONFIG.SEMAPHORE_API_KEY) return { sent: 0, note: "Semaphore isn't set up (SEMAPHORE_API_KEY)" };

  // Daily cap (Philippine time). The script lock means no two checks run at once.
  var today = manilaDay_();
  var sms = fsGet_("notifyState/sms") || {};
  var used = sms.day === today ? Number(sms.count) || 0 : 0;
  var allowed = Math.max(0, Math.min(numbers.length, settings.smsDailyLimit - used));
  var to = numbers.slice(0, allowed);
  var capped = numbers.length - to.length;
  if (to.length === 0) return { sent: 0, capped: capped, note: "daily SMS limit (" + settings.smsDailyLimit + ") reached" };

  var payload = { apikey: CONFIG.SEMAPHORE_API_KEY, number: to.join(","), message: smsText_(message.sms) };
  if (CONFIG.SEMAPHORE_SENDER) payload.sendername = CONFIG.SEMAPHORE_SENDER;
  var res = UrlFetchApp.fetch("https://api.semaphore.co/api/v4/messages", { method: "post", payload: payload, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error("Semaphore " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));

  var update = { day: today, count: used + to.length, limit: settings.smsDailyLimit, updatedAt: new Date() };
  var credits = semaphoreCredits_();
  if (credits !== null) {
    update.credits = credits;
    update.creditsCheckedAt = new Date();
    if (credits < LOW_CREDIT_WARNING && sms.lowCreditWarnedDay !== today) {
      update.lowCreditWarnedDay = today;
      lowCreditsPending_ = credits;
    }
  }
  fsSet_("notifyState/sms", update, true);
  var result = { sent: to.length, capped: capped };
  if (note) result.note = note;
  return result;
}

var lowCreditsPending_ = null;

function semaphoreCredits_() {
  try {
    var res = UrlFetchApp.fetch("https://api.semaphore.co/api/v4/account?apikey=" + encodeURIComponent(CONFIG.SEMAPHORE_API_KEY), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var credits = Number(JSON.parse(res.getContentText()).credit_balance);
    return isFinite(credits) ? credits : null;
  } catch (e) {
    return null;
  }
}

/** Once a day when credits run low: push + email + Telegram to the admins. */
function warnLowCredits_(ctx) {
  if (lowCreditsPending_ === null) return;
  var credits = lowCreditsPending_;
  lowCreditsPending_ = null;
  var admins = ctx.staff().filter(function (u) { return u.role === "administrator"; });
  var warn = {
    event: "lowCredits",
    title: "SMS credits low: " + credits + " left",
    body: "Semaphore has " + credits + " SMS credits left. Load more at semaphore.co so text alerts keep working.",
    url: "/notifications",
  };
  [
    function () { sendWeb_(ctx, admins.map(function (u) { return u.id; }), warn); },
    function () { sendEmail_(admins.map(function (u) { return u.email; }).filter(Boolean), warn); },
    function () { sendTelegramTo_(admins, ctx.prefs(), warn, false); },
  ].forEach(function (send) {
    try { send(); } catch (e) { Logger.log("Low-credit warning failed: " + e); }
  });
}

/* ---------- Telegram (free) ---------- */

function telegramText_(message) {
  var icon = EMOJI[message.event] || "🔔";
  var link = appUrl_(message.url || "/notifications");
  return (icon + " SmartChip: " + message.title + "\n\n" + message.body + (link ? "\n\nOpen SmartChip: " + link : "")).slice(0, 4000);
}

function sendTelegramTo_(people, prefs, message, isTest) {
  if (people.length === 0) return { sent: 0 };
  var linked = people.filter(function (u) {
    var id = prefs[u.id] && prefs[u.id].telegramChatId;
    return typeof id === "string" && /^-?\d{5,20}$/.test(id);
  });
  var notLinked = people.length - linked.length;
  var note = notLinked > 0 && isTest ? "Telegram isn't connected yet (Alerts → Connect Telegram)" : "";
  if (linked.length === 0) return note ? { sent: 0, note: note } : { sent: 0 };
  if (!CONFIG.TELEGRAM_BOT_TOKEN) return { sent: 0, note: "Telegram isn't set up (TELEGRAM_BOT_TOKEN)" };

  var text = telegramText_(message);
  var requests = linked.map(function (u) {
    return {
      url: "https://api.telegram.org/bot" + CONFIG.TELEGRAM_BOT_TOKEN + "/sendMessage",
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ chat_id: prefs[u.id].telegramChatId, text: text, disable_web_page_preview: true }),
      muteHttpExceptions: true,
    };
  });
  var sent = 0;
  var dropped = [];
  UrlFetchApp.fetchAll(requests).forEach(function (res, i) {
    var code = res.getResponseCode();
    if (code === 200) {
      sent++;
    } else if (code === 403 || code === 400) {
      // Blocked the bot or deleted the chat: disconnect so we stop trying.
      dropped.push(linked[i].nickname || linked[i].email);
      fsSet_("notifyPrefs/" + linked[i].id, { telegramChatId: null, telegramName: null, updatedAt: new Date() }, true);
    } else {
      throw new Error("Telegram " + code + ": " + res.getContentText().slice(0, 200));
    }
  });
  var notes = [note, dropped.length ? "disconnected: " + dropped.join(", ") : ""].filter(Boolean).join("; ");
  return notes ? { sent: sent, note: notes } : { sent: sent };
}

/* =====================================================================
 * Firestore REST (as you, so the security rules don't apply here)
 * ===================================================================== */

function checkConfig_() {
  if (!CONFIG.PROJECT_ID) throw new Error("Fill in CONFIG.PROJECT_ID at the top of the script.");
}

function base_() {
  return "https://firestore.googleapis.com/v1/projects/" + CONFIG.PROJECT_ID + "/databases/(default)/documents";
}

function docName_(path) {
  return "projects/" + CONFIG.PROJECT_ID + "/databases/(default)/documents/" + path;
}

function docUrl_(path) {
  return base_() + "/" + path.split("/").map(encodeURIComponent).join("/");
}

function authRequest_(method, url, body) {
  var req = {
    url: url,
    method: method,
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      // Bill/quota the Firebase project, not this script's hidden project.
      "X-Goog-User-Project": CONFIG.PROJECT_ID,
    },
  };
  if (body !== undefined) req.payload = JSON.stringify(body);
  return req;
}

/** Authorised Google API call. `allow`: status codes that aren't errors. */
function api_(method, url, body, allow) {
  var req = authRequest_(method, url, body);
  var res = UrlFetchApp.fetch(url, req);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
  if (code >= 300 && (!allow || allow.indexOf(code) < 0)) {
    var why = (json.error && json.error.message) || text.slice(0, 300);
    if (code === 403 && /PERMISSION_DENIED|permission/i.test(why)) {
      why += " (Run this script with the Google account that owns the Firebase project, and allow all the permissions.)";
    }
    throw new Error(method.toUpperCase() + " " + url.split("?")[0].replace(/^https:\/\/[^/]+/, "") + " -> " + code + ": " + why);
  }
  return { code: code, json: json };
}

function fsGet_(path) {
  var res = api_("get", docUrl_(path), undefined, [404]);
  return res.code === 404 ? null : fromDoc_(res.json);
}

function fsBatchGet_(paths) {
  var res = api_("post", base_() + ":batchGet", { documents: paths.map(docName_) });
  var byName = {};
  (res.json || []).forEach(function (r) {
    if (r.found) byName[r.found.name] = fromDoc_(r.found);
  });
  return paths.map(function (p) { return byName[docName_(p)] || null; });
}

/** filters: [[field, op, value]]; ops: EQUAL, GREATER_THAN, ... */
function fsQuery_(collection, filters, orderBy, limit) {
  var where = (filters || []).map(function (f) {
    return { fieldFilter: { field: { fieldPath: f[0] }, op: f[1], value: toValue_(f[2]) } };
  });
  var q = { from: [{ collectionId: collection }] };
  if (where.length === 1) q.where = where[0];
  if (where.length > 1) q.where = { compositeFilter: { op: "AND", filters: where } };
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy }, direction: "ASCENDING" }];
  if (limit) q.limit = limit;
  var res = api_("post", base_() + ":runQuery", { structuredQuery: q });
  return (res.json || []).filter(function (r) { return r.document; }).map(function (r) { return fromDoc_(r.document); });
}

function fsList_(collection) {
  var out = [];
  var token = "";
  do {
    var res = api_("get", base_() + "/" + collection + "?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    (res.json.documents || []).forEach(function (d) { out.push(fromDoc_(d)); });
    token = res.json.nextPageToken || "";
  } while (token);
  return out;
}

/** Writes fields. merge=true: only these fields change; false: replaces the document. */
function fsSet_(path, data, merge) {
  var url = docUrl_(path);
  if (merge) {
    url += "?" + Object.keys(data).map(function (k) { return "updateMask.fieldPaths=" + encodeURIComponent(k); }).join("&");
  }
  api_("patch", url, { fields: toFields_(data) });
}

function fsAdd_(collection, data) {
  api_("post", base_() + "/" + collection, { fields: toFields_(data) });
}

function fsDelete_(path) {
  api_("delete", docUrl_(path), undefined, [404]);
}

function loadState_() {
  var doc = fsGet_("notifyState/notifier");
  return doc && doc.json ? JSON.parse(doc.json) : {};
}

function saveState_(state) {
  fsSet_("notifyState/notifier", { json: JSON.stringify(state), updatedAt: new Date() });
}

/* ---------- Firestore value <-> JavaScript ---------- */

/** A timestamp filter value kept exactly as Firestore wrote it. */
function ts_(iso) {
  return { __ts: iso };
}

function toValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v.__ts) return { timestampValue: v.__ts };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue_) } };
  return { mapValue: { fields: toFields_(v) } };
}

function toFields_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function (k) {
    if (obj[k] !== undefined) fields[k] = toValue_(obj[k]);
  });
  return fields;
}

function fromValue_(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue; // ISO string
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue_);
  if ("mapValue" in v) return fromFields_(v.mapValue.fields || {});
  if ("referenceValue" in v) return v.referenceValue;
  return null;
}

function fromFields_(fields) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) { out[k] = fromValue_(fields[k]); });
  return out;
}

function fromDoc_(doc) {
  var out = fromFields_(doc.fields || {});
  out.id = doc.name.split("/").pop();
  return out;
}

function toMs_(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime();
  return isFinite(t) ? t : 0;
}

function maxIso_(a, b) {
  return toMs_(b) > toMs_(a) ? b : a;
}

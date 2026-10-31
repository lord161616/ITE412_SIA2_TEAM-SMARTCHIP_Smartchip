# What changed in the rebuild

Round 1 cleaned up and fixed the web app. Round 2 (further down) introduced a
fresh data model and new ESP32 firmware, so start from an empty database
(see SETUP.md).

## Bugs fixed

| Problem before | Cause | Now |
| --- | --- | --- |
| Dashboard **START / STOP did nothing** | Buttons were placeholders that only printed to the console | Dashboard uses the real controls (shared with Drying control). START goes to the start form |
| Temperature slider went to **80 °C** (the emergency cut-off) and did nothing | Slider limits didn't match the 75 °C max, and it wasn't wired up | Removed. Target is set per run (30–75 °C), validated in the app and in the rules |
| **Stop Drying → "permission denied"** while preheating or drying | Web STOP rule only allowed `starting` / `fault` | Rule allows `starting`, `preheating`, `drying`, `fault` |
| **Recovery Mode failed** | Wrote `remainingSeconds` to the run (not allowed), and couldn't set the heater to OFF on the device | Writes only allowed fields; device recovery rule may now set `heaterState` / `fanState` to OFF |
| **Couldn't start the next batch after a run finished** | Machine stayed `completed`; nothing in the app moved it back to idle | **Ready for next batch** button (uses the existing acknowledge rule) |
| **Stuck in fault** with no way out | No rule or button for a fault with no run attached | New **Clear fault** button + rule (only when no run is attached) |
| **SSR always OFF, both SHT31 sensors always "Offline"**, false sensor alerts | App read `ssrState` and `sensors.*`, which the rules don't let the ESP32 write | Reads `heaterState` / `fanState` (what the ESP32 writes). Per-sensor cards appear only if the firmware reports them |
| Device showed **offline forever if the PC clock was off** by more than 1 minute | Compared server `lastSeen` with the PC clock | Once a heartbeat is seen, "online" = a heartbeat arrived in the last 60 s by our own clock |
| **History yield always "-"** | Nothing could ever set `finalWeight` / `driedWeight` | **Inventory → Weigh** on Dried batches (2 small new rules) |
| History **date filter reset** whenever data changed | Filtered list was overwritten on every update | Filters apply live and stay put. Also added CSV export |
| "Profile not found" right after **registering** | Profile was read once, before it had been written | Profile is a live listener with a short grace period |
| Drying control's **batch list didn't update** | Loaded once with `getDocs` | Live list |
| Pending users had a **Deactivate** button instead of Activate | Button only checked for `inactive` | Pending / inactive → Activate |
| User details form **reset while typing** | Re-initialised on every live update | Only resets when a different user is opened |
| Users with no `createdAt` **disappeared** from lists | `orderBy("createdAt")` drops docs without the field | Sorted in the browser instead |
| Missing icons on Users | Used Font Awesome classes, but Font Awesome wasn't loaded | Lucide icons throughout |
| Logged-out shop visitors saw an **empty sidebar with Logout** | — | Shows Shop + a Sign in button |
| Harvest dates could show **the day before** | `"2026-10-27"` parsed as UTC | Parsed as a local date |
| **Staff created by the Cloud Function had no password** and couldn't log in | Function existed but wasn't wired to the app | **Users → Add staff** calls it and emails a password-setup link. Login has **Forgot password** |
| Styles changed depending on page | `.card`, `.badge`, `.progress`… were defined differently in several CSS files | One design system: tokens in `base.css`, page styles scoped |
| `.env` contained JavaScript | — | Real `VITE_FIREBASE_*` settings. The app shows a clear message if they're missing |

## New

- **Live trend chart** on the Dashboard and Sensors pages, built from readings
  received while the app is open. It survives switching pages.
- **Alerts** page with real, live alerts: offline mid-run, faults, over-target and
  over-safety temperature, commands the ESP32 hasn't confirmed, sensor dropouts,
  and run finished.
- **Analytics** from your real drying runs: completed runs, drying time, average
  yield, yield per batch chart, and success rate.
- Proper confirm dialogs and toast messages instead of browser `confirm()` and `alert()`.
- Pages load on demand, so the first load is faster.
- Works on phones (slide-out menu).

## Removed (unused)

- Components: `AddUserForm`, `NewScheduleModal`, `StatCard`, `ProgressCard`, `ControlCard`
- `services/dryingWorkflowService.js`, plus duplicate constants in `dryingRunService.js` and `deviceService.js`
- `pages/DebugCreateProfile.jsx`: it always failed, because the rules only allow creating customer profiles
- `styles/dryingHistory.css`, `App.css`, and the old per-page CSS files
- Images: `bvd.jpg`, `c.png`, `d.jpg`, `login-visual.png`, `smartchip-logvcxo.png`
- `react-icons` dependency (lucide-react covers everything)
- `firebase-debug.log`

## Round 2: fresh data model + new firmware

The database was going to be wiped for the client anyway, so the second round
replaced the old field layout with a clean one, designed together with the new
ESP32 firmware. See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for every field.

- **One owner per field.** The ESP32 writes the machine state. The web app writes only
  `devices/{id}.command`. The old duplicates (`machineStatus` / `state`, `ssr` /
  `ssrState` / `heater` / `heaterState`, `currentTemp` / `temperature`, `sensor1Temp`…) are gone.
- **The ESP32 keeps runs and batches up to date itself:** preheating → drying → completed / stopped / failed,
  and the batch → Dried or back to Fresh. History stays right even when nobody has the app open.
- **The countdown starts when the target temperature is reached**, matching the firmware.
  It is stored as `dryingStartedAt`, separately from `startedAt` (heater on).
- **Safe START.** The ESP32 records "accepted" in Firestore *before* heating, rejects stale
  or impossible STARTs with a reason the app shows, and fails a run cleanly after a power cut.
- **Buttons still work.** A run started on the machine shows up as a *Local run*.
- **New in the app:** Cancel START (if the ESP32 hasn't picked it up), rejection reasons,
  "someone is using the machine's menu", per-sensor readings, and drying time set in hours with 15-minute steps (max 12 h, the firmware's limit).
- `firestore.rules` was rewritten for this model.
  The ESP32 is identified by its account UID in `isDevice()`; see [SETUP.md](SETUP.md).

The firmware changes are listed in [firmware/README.md](firmware/README.md).

## Round 3: shop

Free (no paid services): reserve online, pay by GCash reference or cash on pickup.

- **Shop** in the sidebar has two tabs for operators/administrators: **Storefront** (what customers
  see) and **Manage shop**. Customers and visitors only see the storefront.
- **Dried batch → listing.** Weighed Dried batches show up under *Dried batches ready to list*.
  Publish with an amount for sale (up to the dried weight), 1–4 package sizes with prices, and show/hide.
- **Storefront.** Anyone can browse published listings. Signed-in customers reserve a package size × quantity,
  choose a pickup day and GCash or cash.
- **Atomic stock.** The reservation and the stock decrease are one transaction, and the rules check
  both sides, so stock can't be oversold or prices changed from the browser.
- **Payment.** The customer sends GCash and enters the reference number. Only the shop manager can mark it
  **verified** (after checking their GCash), or **not found** (the customer can resend). Cash is recorded at pickup.
- **Manage shop.** Live reservations list with customer contact and pickup day: Verify payment,
  Mark ready, Collected, Cancel with a reason (stock goes back). GCash orders unpaid for 24 h are flagged.
  Sales total (collected), listings with available/reserved stock, and payment & pickup settings.
- **Notifications in the app.** A badge on **Shop** in the sidebar and a pop-up for new reservations and
  GCash payments while a manager has the app open.
- **Firmware 2.0.1:** prints why the first Firestore read failed (rules / project ID) instead of retrying silently.

## Things to know

- `src/assets/mushroom-bg.png` (sign-in background) has a visible **"dreamstime" watermark**.
  That's a stock photo preview, so replace it before going public.
- `src/assets/oyster.jpg` is actually a SmartChip logo, not a mushroom photo. Swap in a real
  product photo with the same file name when you have one.

## Round 4: pay-first shop + more analytics

- **Pay first.** Customers send the GCash payment and enter the reference number in
  the order form; an order can't be placed without one (enforced in `firestore.rules`).
  Cash on pickup is gone for new orders (old cash orders still display and can be completed).
- Stock is held while the shop manager checks the payment. Orders can only be marked
  **ready** once the payment is **verified**.
- "Not found" payments: the customer can resend the reference or cancel; after 24 h the
  manager sees a flag to cancel and release the stock.
- Customers can no longer cancel a paid order themselves; the farm cancels and refunds.
- Sidebar: Inventory → Drying Control → Sensors.
- Analytics: Drying / Shop tabs, date range, 14 charts.

**Deploy the new rules:** `npm run deploy:rules`

## Round 5: notifications (web push, Gmail, SMS, Telegram) + Alerts page

- **Cloud Function notifier** (`functions/notify/`). It watches Firestore and sends:
  web push (free, Firebase Cloud Messaging), email (free, Gmail app password) and SMS
  (Semaphore, prepaid) and Telegram (free, the farm's own bot). The ESP32 firmware is unchanged.

  | Event | Web | Email | SMS | Telegram |
  | --- | --- | --- | --- | --- |
  | Fault / over-temperature | ✓ | ✓ | ✓ | ✓ |
  | Offline during a run (checked every 5 min) | ✓ | ✓ | ✓ | ✓ |
  | Drying complete | ✓ | ✓ | ✓ | ✓ |
  | Run started / stopped | ✓ | | | |
  | New shop order (operators + admins) | ✓ | ✓ | | ✓ |

  These are the defaults; admins change them on **Alerts → Notification settings**.
- **SMS money safety:** only ticked events and ticked people get texts; texts are plain
  characters under 160 (1 credit each); a daily limit (default 10, Philippine time) counted
  in a transaction; one SMS per fault (not repeated); "back online" never uses SMS; admins
  get an email + push when Semaphore credits drop below 20.
- **Alerts page:** this-device push on/off, "send me a test" (web / email / SMS), who-gets-what
  grid, SMS cost estimate, a log of everything sent with today's SMS count and credits left,
  and a recent activity timeline.
- **Everyone has their own switches** (Alerts → My notifications): turn web, email, SMS or
  Telegram off for yourself. A person gets a channel only if an admin gave it to them AND
  they left it on. Admins see "off by them" / "not connected" in the who-gets-what grid.
- **Telegram in one tap:** "Connect Telegram" gives a personal link; open it, press Start,
  done (the bot's webhook saves the chat). `/stop` in Telegram disconnects. Groups can be
  added by chat ID. If someone blocks the bot, they're disconnected automatically.
- New Firestore rules for `settings/notifications`, `notifyPrefs`, `pushTokens`,
  `notificationLog`, `notifyState`. New env var `VITE_FIREBASE_VAPID_KEY`. New secret
  `TELEGRAM_BOT_TOKEN`; new functions `telegramLink`, `telegramWebhook`.
- No SMS needed for anything to work: leave Semaphore set to `none` and only web + email are used.

**Setup:** SETUP.md, step 7.

## Round 6: free notifier (no Firebase Blaze plan)

- **Cloud Functions removed.** Everything now runs on the free **Spark** plan. Alerts, "Send me a
  test", "Connect Telegram" and **Users → Add staff** are handled by a free **Google Apps Script**
  (`notifier/Code.gs`) that checks Firestore every minute under your Google account.
- Same channels and settings as before: web push, Gmail and Telegram are free; SMS (Semaphore) is
  the only thing that costs money, with the same daily limit and money safety.
- Alerts arrive within about a minute (was: seconds).
- The web app asks the notifier for things through a new `jobs` collection; the notifier writes
  the result back. New rules for `jobs`; staff can read `notifyState/status`.
- **Alerts → Sent notifications** shows whether the notifier is running ("Notifier running · 30s ago").
- Emails come from the Google account that runs the script (no Gmail app password needed).

**Setup:** SETUP.md, step 7 (paste the script, fill in `CONFIG`, run `setup`), then `npm run deploy:rules`.

## Round 7: hosting on Vercel (Firebase Hosting removed)

- Firebase Hosting config and `npm run deploy:hosting` removed. Firebase now only provides the
  database, logins and push notifications (free Spark plan).
- `vercel.json` added: Vite build to `dist`, every page served by `index.html`, `sw.js` never cached.
- Notifier: set `CONFIG.APP_URL` to your Vercel address; until then, messages go without a link.
- SETUP.md step 8: GitHub + Vercel, environment variables, Firebase authorized domain.

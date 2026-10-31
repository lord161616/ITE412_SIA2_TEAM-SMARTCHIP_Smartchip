# SmartChip setup (fresh database)

Follow this once, from top to bottom. It takes about 30 minutes. It works
the same for a brand-new Firebase project for your client or for wiping your
current one.

---

## 1. Firebase project

1. **Use a project.** In the [Firebase console](https://console.firebase.google.com), create a project or open your existing one.
2. **Wipe the old data.**
   - In Firestore, open each collection's **⋮** menu and choose **Delete collection**: `users`, `devices`, `dryingRuns`, `inventory`, `esp32Tests`.
   - Or, with the Firebase CLI: `firebase firestore:delete --all-collections --project YOUR_PROJECT_ID`.
   - Under Authentication > Users, delete old accounts you don't need.
3. **Turn on sign-in.** Go to Authentication > Sign-in method and enable **Email/Password**.
4. **Create the database.** In Firestore Database, create it in production mode (location `asia-southeast1` is closest to you).
5. **Register the web app.** Go to Project settings > General > Your apps and add a **Web app**. Copy its config values into `.env` in the project root (see `.env.example`). If you're keeping project `smartchip-5de59`, `.env` is already filled in.

## 2. The ESP32's own login

The ESP32 signs in like a user, with its own email and password.

1. Go to Authentication > Users > **Add user**. Use an email such as `esp32@smartchip.local` and a long random password.
2. **Copy its User UID** from the user list.
3. Open `firestore.rules` and paste the UID into `isDevice()`:
   ```
   function isDevice() {
     return signedIn() && request.auth.uid in [
       "PASTE_THE_UID_HERE"
     ];
   }
   ```
4. Deploy the rules. You need the Firebase CLI: `npm i -g firebase-tools`, then `firebase login`.
   ```
   firebase use YOUR_PROJECT_ID   # only if it's a different project than .firebaserc
   npm run deploy:rules
   ```

## 3. Web app + first administrator

```
npm install
npm run dev        # open http://localhost:5173
```

1. Click **Create an account** and register yourself. You become a *customer*.
2. In the Firebase console, open Firestore > `users` > your document and edit three fields:
   - `role` → `administrator`
   - `accountType` → `staff`
   - `status` → `active`
3. Reload the app. You now see the Dashboard and the Users page.
4. Add other staff in one of two ways:
   - **Users → Add staff.** This needs the free notifier script (step 7). It takes up to a minute.
   - Or have them register, then change their role on the Users page.

## 4. Flash the ESP32

1. Install the [Arduino IDE](https://www.arduino.cc/en/software).
2. **ESP32 boards.** Under Boards Manager, install **esp32 by Espressif** (2.x or 3.x both work).
3. **Libraries.** In Library Manager, install:
   - **Adafruit SHT31 Library** (it also asks for Adafruit BusIO; say yes)
   - **LiquidCrystal I2C** by Frank de Brabander
   - **ArduinoJson** by Benoit Blanchon (version 7)
4. Open `firmware/smartchip_esp32/smartchip_esp32.ino`.
5. Copy `secrets.example.h` to `secrets.h` in the same folder and fill in:
   - your 2.4 GHz Wi-Fi name and password,
   - the Firebase **Web API key** and **Project ID** (Project settings > General),
   - the ESP32 account email and password from step 2.
6. Choose Tools > Board > **ESP32 Dev Module**, select the port, and click **Upload**.
7. Open the Serial Monitor at **115200** baud. You should see:
   ```
   [cloud] Wi-Fi connected, IP 192.168.x.x
   [auth] signed in as esp32@... (uid ...)
   ```
   The top-right corner of the LCD shows **W** when connected.

The ESP32 creates `devices/SMARTCHIP-ESP32-01` by itself. The Dashboard shows
**Device online** within about 10 seconds.

## 5. First test (do this with the chamber empty)

1. **Inventory → Add batch** (any weight).
2. **Drying control.** Pick the batch, set 35 °C and 0.25 h, then **Start drying**.
   - Within about 5 s the status changes to **Preheating** and the heater turns ON.
   - At 35 °C it switches to **Drying** and the countdown starts. After 15 minutes it shows **Completed**, and the batch becomes Dried.
3. **Stop test.** Start another run, then click **Stop drying**. The heater turns off within about 5 s and the batch goes back to Fresh.
4. **Button test.** Unplug the router (or switch Wi-Fi off) and run a 1-minute dry with the physical buttons. Plug the router back in. A "Local run" appears in History.
5. **Power test.** During a run, unplug the ESP32 for a few seconds. When it restarts, the run shows as failed with *Power loss* and the batch is back to Fresh.

## 6. Shop

1. Run `npm run deploy:rules` (the shop added new rules).
2. Sign in as an operator or administrator → **Shop** → **Manage shop** tab →
   **Payment & pickup → Edit**. Enter your GCash number and name, pickup address and hours.
3. After a drying run completes, **weigh** the batch in Inventory. It then appears under
   **Dried batches ready to list** → **Publish**. Set the amount for sale, package sizes and prices.
4. Customers see it on the storefront (no sign-in needed to browse, a free account to reserve).
5. When a GCash reference comes in, check your GCash app, then **Verify payment**.
   **Mark ready** when packed (only after the GCash payment is verified), **Collected** when picked up.

New reservations and payments show a badge on **Shop** in the sidebar and a pop-up
while you have the app open (any page).

## 7. Notifications + Add staff (free notifier script)

Everything here runs on the **free Firebase Spark plan**. A small Google Apps
Script (`notifier/Code.gs`) runs on Google's servers every minute under your
Google account. It watches Firestore and sends the alerts, and it also handles
"Send me a test", "Connect Telegram" and "Users → Add staff". The ESP32 needs
nothing new. **Only SMS costs money** (Semaphore credits, optional).

| Channel | Cost | You need |
| --- | --- | --- |
| Web push | Free | A web push key (a) |
| Email | Free | Nothing: sent from your Google account (about 100 a day) |
| Telegram | Free | A bot token (b) |
| SMS | ≈ ₱0.63 a text, prepaid | A Semaphore account (c), optional |

**a) Web push key**
1. Firebase console → ⚙ Project settings → **Cloud Messaging** → *Web Push certificates* →
   **Generate key pair**.
2. Copy the key into `.env` as `VITE_FIREBASE_VAPID_KEY=…`, then publish the website again
   and to Vercel's environment variables (step 8), then redeploy. Phones need the real `https://…`
   website address, not localhost.

**b) Telegram bot (optional, free)**
1. In Telegram, open **@BotFather**, send `/newbot`, pick a name (e.g. "SmartChip Farm") and a
   username ending in `bot`. Copy the **token**.

**c) Semaphore SMS (optional, prepaid)**
1. Sign up at semaphore.co (the account must be for a business) and load a little credit
   (₱100–300 to start).
2. Copy your **API key** (Account → API). Request a **sender name** such as `SMARTCHIP`
   (first one free, approval up to 5 business days). Until it's approved, leave the sender empty.

**d) Install the notifier script**
1. Open **script.google.com** signed in with the Google account that **owns the Firebase
   project** (the one you use in the Firebase console). Click **New project** and name it
   "SmartChip notifier".
2. Delete what's in `Code.gs` and paste the whole of `notifier/Code.gs` from this project.
3. ⚙ **Project Settings** → tick **Show "appsscript.json" manifest file in editor**. Back in the
   editor, open `appsscript.json` and replace it with `notifier/appsscript.json`.
4. At the top of `Code.gs`, fill in `CONFIG`: `APP_URL` (your website address, e.g.
   `https://smartchip.vercel.app`; links in emails and Telegram open it), `TELEGRAM_BOT_TOKEN`,
   `SEMAPHORE_API_KEY` and `SEMAPHORE_SENDER`. Leave the last three `""` to keep that channel off.
   `PROJECT_ID` is already filled in. Click 💾 **Save**.
5. Choose **setup** in the function list at the top and click **Run**. Google asks for
   permission: **Review permissions** → pick your account → "Google hasn't verified this app"
   → **Advanced** → **Go to SmartChip notifier (unsafe)** → **Allow**. (It's your own script;
   Google shows this warning for every personal script.)
6. The log should end with *"Done. The notifier checks every minute."* Optional: run
   **sendTestToMe** to get a test email (and Telegram, once connected).

Emails come **from the Google account that runs the script**. To send from a separate farm
Gmail instead, add that Gmail to the Firebase project (console → ⚙ → Users and permissions →
*Editor*) and install the script while signed in with it.

To stop the notifier, run **stopNotifier**. After changing `CONFIG`, save and run **setup** again.

**e) Deploy the rules and turn it on**
1. `npm run deploy:rules`
2. **Users page:** everyone who should get texts needs a mobile number (09…).
3. **Alerts → Notification settings** (admins): tick which events go to web / email / SMS /
   Telegram and who gets each channel, set the SMS daily limit, save.
4. **Each person, on each phone or computer:** Alerts → This device → **Turn on for this
   device**. On iPhone, first open the site in Safari → Share → **Add to Home Screen**, and use it
   from that icon.
5. **Each person:** Alerts → My notifications → **Connect Telegram** → open the link → press
   **Start**. They can switch any channel off for themselves there too.
6. **Send me a test** (This device card). Tests and alerts arrive within about a minute.
7. **Sent notifications** shows "Notifier running · …" when the script is working, every alert
   it sent, today's SMS count and credits left, and the reason anything wasn't sent.

**Free limits (far above what a farm uses):** the script runs about 1,440 times a day (Apps
Script allows 90 minutes of running time a day; each check takes a second or two), Gmail sends
about 100 emails a day, and Firestore's free plan allows 50,000 reads a day. If Google ever emails
"Service using too much computer time", change `everyMinutes(1)` to `everyMinutes(5)` in
`setup` and run setup again.

## 8. Put the website online (GitHub + Vercel)

The website is a plain static build hosted on Vercel (free). Firebase provides the database,
logins and push notifications (free Spark plan); it doesn't host the website.

1. Push the project to GitHub and **Import** it at vercel.com. `vercel.json` already sets the
   build (`npm run build` → `dist`) and sends every page to `index.html` so links like
   `/dashboard` work on refresh.
2. Vercel → Project → **Settings → Environment Variables**: add every `VITE_FIREBASE_…` line from
   your `.env` (including `VITE_FIREBASE_VAPID_KEY`). Redeploy after adding them.
3. Firebase console → **Authentication → Settings → Authorized domains** → add your Vercel
   domain (e.g. `smartchip.vercel.app`, plus your own domain if you add one).
4. In the notifier script, set `CONFIG.APP_URL` to the Vercel address, save, run **setup** again
   (links in emails and Telegram point there).
5. Turn on **This device** from the Vercel address (push permission belongs to the website's
   address; if you ever change the address, do it again there).

Every push to GitHub redeploys the website. Database rules still go to Firebase with
`npm run deploy:rules`.

## Troubleshooting

| What you see | Meaning / fix |
| --- | --- |
| LCD corner `-` | No Wi-Fi. Check `WIFI_SSID` / `WIFI_PASSWORD`, and that the network is 2.4 GHz. |
| LCD corner `!`, Serial `sign-in failed (400)` | Wrong device email or password, wrong API key, or Email/Password sign-in not enabled. |
| Serial `commit failed (403)` | The ESP32's UID isn't in `isDevice()` in `firestore.rules`, or the rules weren't deployed. |
| Dashboard "Device not set up" | The ESP32 hasn't written yet. Check the Serial Monitor. |
| START shows "rejected: sensors aren't giving readings" | One of the SHT31s isn't responding. Check the wiring and addresses 0x44 / 0x45. |
| START shows "rejected: someone is using the menu" | Press STOP on the machine to leave the LCD menu. |
| Web app "You don't have permission…" | Your user isn't `active` + `staff` + the right role, or the rules weren't deployed. |

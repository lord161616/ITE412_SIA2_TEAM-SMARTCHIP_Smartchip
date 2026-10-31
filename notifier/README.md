# SmartChip notifier (Google Apps Script)

Free replacement for Cloud Functions, so SmartChip runs on Firebase's free Spark plan.

- `Code.gs`: paste into a new project at script.google.com
- `appsscript.json`: the project's manifest (permissions)

Every minute it checks Firestore and sends web push, email (from your Gmail), Telegram and
SMS (Semaphore) according to the Alerts page settings. It also runs "Send me a test",
"Connect Telegram" and "Users → Add staff" for the web app (the `jobs` collection).

Setup: [SETUP.md, step 7](../SETUP.md). Functions you can run from the editor:

| Function | What it does |
| --- | --- |
| `setup` | Checks access, connects the Telegram bot, starts the 1-minute timer. Run again after changing `CONFIG`. |
| `sendTestToMe` | Sends a test to you on every channel |
| `stopNotifier` | Stops the timer |

Logs: script.google.com → Executions.

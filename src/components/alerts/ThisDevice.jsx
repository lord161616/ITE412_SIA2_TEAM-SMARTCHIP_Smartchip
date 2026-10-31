import { BellOff, BellRing, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import useAction from "../../hooks/useAction";
import { disablePush, enablePush, pushStatus, sendTestNotification } from "../../services/notificationService";
import { Card } from "../ui/Card";
import { Notice } from "../ui/States";
import StatusBadge from "../ui/StatusBadge";

const STATUS_LOOK = {
  on: ["On", "success"],
  off: ["Off", "neutral"],
  blocked: ["Blocked", "warning"],
  unsupported: ["Not supported", "neutral"],
  checking: ["…", "neutral"],
};

/** Turn web push on for THIS phone / computer, and send yourself a test. */
export default function ThisDevice() {
  const { user } = useAuth();
  const [status, setStatus] = useState("checking");
  const [testChannels, setTestChannels] = useState({ web: true, email: false, sms: false, telegram: false });

  useEffect(() => {
    let alive = true;
    pushStatus().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  const [turnOn, turningOn] = useAction(enablePush, {
    success: "Notifications are on for this device.",
    onSuccess: () => setStatus("on"),
  });
  const [turnOff, turningOff] = useAction(disablePush, {
    success: "Notifications are off for this device.",
    onSuccess: () => setStatus("off"),
  });
  const [test, testing] = useAction(sendTestNotification, {
    confirm: (_uid, channels) =>
      channels.includes("sms")
        ? { title: "Send a test SMS?", message: "This uses 1 Semaphore credit (about ₱0.63).", confirmLabel: "Send test" }
        : undefined,
    success: (result) => {
      const parts = Object.entries(result?.results ?? {}).map(
        ([ch, r]) => `${ch}: ${r.sent ? "sent" : r.note || "not sent"}`,
      );
      return `Test done. ${parts.join(" · ")}${result?.errors?.length ? ` · ${result.errors.join("; ")}` : ""}`;
    },
  });

  const [label, tone] = STATUS_LOOK[status];
  const chosen = Object.keys(testChannels).filter((k) => testChannels[k]);

  return (
    <Card
      title="This device"
      subtitle="Get pop-up notifications on this phone or computer, even when SmartChip is closed."
      actions={<StatusBadge tone={tone} label={label} />}
    >
      <div className="stack-sm">
        {status === "unsupported" && (
          <Notice tone="info">
            This browser can't receive notifications. On iPhone (iOS 16.4+), tap Share → <strong>Add to Home Screen</strong>,
            open SmartChip from the new icon, then come back here.
          </Notice>
        )}
        {status === "blocked" && (
          <Notice tone="warning">
            Notifications are blocked for this site. Allow them in the browser's site settings (the icon next to the
            address), then reload.
          </Notice>
        )}

        <div className="button-row">
          {status === "on" ? (
            <button type="button" className="btn btn-ghost" disabled={turningOff} onClick={() => turnOff()}>
              <BellOff size={15} /> Turn off on this device
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={turningOn || status === "unsupported" || status === "blocked" || status === "checking"}
              onClick={() => turnOn(user.uid)}
            >
              <BellRing size={15} /> {turningOn ? "Turning on…" : "Turn on for this device"}
            </button>
          )}
        </div>
        <p className="muted fine-print">Do this once on each phone or computer you want alerts on.</p>

        <div className="notify-test">
          <span className="fine-print">
            <strong>Send me a test:</strong>
          </span>
          {[
            ["web", "Web"],
            ["email", "Email"],
            ["sms", "SMS (₱)"],
            ["telegram", "Telegram"],
          ].map(([key, text]) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={testChannels[key]}
                onChange={(e) => setTestChannels((t) => ({ ...t, [key]: e.target.checked }))}
              />
              {text}
            </label>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={testing || chosen.length === 0} onClick={() => test(user.uid, chosen)}>
            <Send size={14} /> {testing ? "Sending… (up to a minute)" : "Send"}
          </button>
        </div>
      </div>
    </Card>
  );
}

import { ExternalLink, Mail, MessageSquare, MonitorSmartphone, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import useAction from "../../hooks/useAction";
import useLiveData from "../../hooks/useLiveData";
import {
  CHANNELS,
  DEFAULT_PERSONAL,
  DEFAULT_RECIPIENT,
  DEFAULT_SMS_LIMIT,
  defaultChannels,
  disconnectTelegram,
  getTelegramLink,
  NOTIFY_EVENTS,
  setMyChannel,
  setTelegramChatId,
  subscribeToMyDevices,
  subscribeToMyPrefs,
  subscribeToNotifySettings,
} from "../../services/notificationService";
import { Card } from "../ui/Card";
import { Loading, Notice } from "../ui/States";

const ICONS = { web: MonitorSmartphone, email: Mail, sms: MessageSquare, telegram: Send };
const SETTINGS_DEFAULTS = { channels: defaultChannels(), recipients: {}, smsDailyLimit: DEFAULT_SMS_LIMIT, exists: false };
const PREFS_DEFAULTS = { ...DEFAULT_PERSONAL, telegramChatId: null, telegramName: null };

const phMobile = (value) => {
  const d = String(value ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return d;
  if (/^639\d{9}$/.test(d)) return `0${d.slice(2)}`;
  if (/^9\d{9}$/.test(d)) return `0${d}`;
  return null;
};

/**
 * Each person's own switches: turn any channel an admin gave them on or off,
 * and connect Telegram with one tap.
 */
export default function MyNotifications() {
  const { user, profile, canOperate } = useAuth();
  const uid = user?.uid;

  const settings = useLiveData(subscribeToNotifySettings, SETTINGS_DEFAULTS);
  const subscribePrefs = useCallback((onData, onError) => subscribeToMyPrefs(uid, onData, onError), [uid]);
  const subscribeDevices = useCallback((onData, onError) => subscribeToMyDevices(uid, onData, onError), [uid]);
  const prefs = useLiveData(uid ? subscribePrefs : null, PREFS_DEFAULTS);
  const devices = useLiveData(uid ? subscribeDevices : null);

  const [link, setLink] = useState(null); // { url, bot }
  const [manualId, setManualId] = useState("");

  const [toggle, toggling] = useAction(setMyChannel);
  const [connect, connecting] = useAction(getTelegramLink, { onSuccess: (result) => setLink(result) });
  const [saveManual, savingManual] = useAction(setTelegramChatId, {
    success: "Telegram chat saved.",
    onSuccess: () => setManualId(""),
  });
  const [disconnect, disconnecting] = useAction(disconnectTelegram, {
    confirm: { title: "Disconnect Telegram?", message: "You'll stop getting SmartChip messages in Telegram.", confirmLabel: "Disconnect" },
    success: "Telegram disconnected.",
    onSuccess: () => setLink(null),
  });

  if (!uid) return null;
  const s = settings.data;
  const mine = prefs.data;
  const given = { ...DEFAULT_RECIPIENT, ...(s.recipients?.[uid] ?? {}) };
  const phone = phMobile(profile?.phone);
  const telegramLinked = Boolean(mine.telegramChatId);

  // Can this channel actually reach me? (separate from my on/off switch)
  const ready = {
    web: devices.data.length > 0,
    email: Boolean(profile?.email || user?.email),
    sms: Boolean(phone),
    telegram: telegramLinked,
  };
  const detail = {
    web: ready.web
      ? `On ${devices.data.length} device${devices.data.length === 1 ? "" : "s"}`
      : "No device yet. Use “This device” below on each phone or computer.",
    email: profile?.email || user?.email || "No email on your profile",
    sms: phone ? `${phone} · uses prepaid credits` : "No PH mobile number on your profile (an admin can add it on Users)",
    telegram: telegramLinked ? `Connected: ${mine.telegramName || mine.telegramChatId}` : "Not connected yet",
  };

  const events = NOTIFY_EVENTS.filter((e) => canOperate || e.key !== "newOrder");
  const reaches = (event) =>
    CHANNELS.filter((c) => s.channels?.[event.key]?.[c.key] && given[c.key] && mine[c.key] !== false && ready[c.key]);

  return (
    <Card title="My notifications" subtitle="Turn each way of reaching you on or off. Changes apply right away.">
      {(settings.error || prefs.error) && <Notice tone="error">{settings.error || prefs.error}</Notice>}
      {settings.loading || prefs.loading ? (
        <Loading />
      ) : (
        <div className="stack">
          <ul className="channel-list">
            {CHANNELS.map((c) => {
              const Icon = ICONS[c.key];
              const allowed = given[c.key];
              const on = allowed && mine[c.key] !== false;
              return (
                <li key={c.key} className={`channel-row ${allowed ? "" : "is-locked"}`}>
                  <Icon size={18} className="channel-icon" aria-hidden />
                  <div className="channel-body">
                    <strong>
                      {c.label} <span className="muted fine-print">{c.cost}</span>
                    </strong>
                    <span className="muted fine-print">
                      {allowed ? detail[c.key] : "Not turned on for you by an admin (Notification settings)."}
                    </span>

                    {c.key === "telegram" && allowed && (
                      <div className="telegram-connect">
                        {telegramLinked ? (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={disconnecting} onClick={() => disconnect(uid)}>
                            Disconnect
                          </button>
                        ) : link ? (
                          <>
                            <a className="btn btn-primary btn-sm" href={link.url} target="_blank" rel="noreferrer">
                              <ExternalLink size={14} /> Open Telegram, then press Start
                            </a>
                            <span className="muted fine-print">
                              Opens @{link.bot}. This page updates within a minute of pressing Start. The link works for 30 minutes.
                            </span>
                          </>
                        ) : (
                          <button type="button" className="btn btn-primary btn-sm" disabled={connecting} onClick={() => connect(uid)}>
                            <Send size={14} /> {connecting ? "Getting your link…" : "Connect Telegram"}
                          </button>
                        )}
                        {!telegramLinked && (
                          <details className="telegram-manual">
                            <summary className="fine-print">Use a group chat or enter an ID by hand</summary>
                            <form
                              className="pay-ref"
                              onSubmit={(e) => {
                                e.preventDefault();
                                saveManual(uid, manualId);
                              }}
                            >
                              <input
                                className="input"
                                inputMode="numeric"
                                placeholder="e.g. -1001234567890"
                                aria-label="Telegram chat ID"
                                value={manualId}
                                onChange={(e) => setManualId(e.target.value)}
                                maxLength={21}
                              />
                              <button type="submit" className="btn btn-ghost btn-sm" disabled={savingManual || !manualId.trim()}>
                                Save
                              </button>
                            </form>
                            <span className="muted fine-print">
                              Add the farm's bot to the group, then add @userinfobot to read the group's ID (starts with "-").
                            </span>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                  <label className="switch" title={allowed ? undefined : "An admin hasn't given you this channel"}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`${c.label} notifications`}
                      checked={on}
                      disabled={!allowed || toggling}
                      onChange={(e) => toggle(uid, c.key, e.target.checked)}
                    />
                    <span className="switch-track" aria-hidden />
                  </label>
                </li>
              );
            })}
          </ul>

          <div>
            <h4 className="subhead">What you'll get</h4>
            <ul className="reach-list">
              {events.map((e) => {
                const via = reaches(e);
                return (
                  <li key={e.key}>
                    <span>{e.label}</span>
                    <span className={via.length ? "" : "muted"}>{via.length ? via.map((c) => c.label).join(", ") : "Nothing"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

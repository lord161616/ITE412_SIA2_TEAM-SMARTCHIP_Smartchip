import { useState } from "react";
import { ROLES } from "../../config/constants";
import { useAuth } from "../../context/AuthContext";
import useAction from "../../hooks/useAction";
import useLiveData from "../../hooks/useLiveData";
import {
  CHANNELS,
  DEFAULT_RECIPIENT,
  DEFAULT_SMS_LIMIT,
  defaultChannels,
  NOTIFY_EVENTS,
  saveNotifySettings,
  subscribeToAllPrefs,
  subscribeToNotifySettings,
} from "../../services/notificationService";
import { subscribeToUsers } from "../../services/userService";
import { Card } from "../ui/Card";
import { Loading, Notice } from "../ui/States";
import StatusBadge from "../ui/StatusBadge";

const DEFAULTS = { channels: defaultChannels(), recipients: {}, smsDailyLimit: DEFAULT_SMS_LIMIT, exists: false };

/** Same rule as the Cloud Function: a PH mobile number, or null. */
function phMobile(value) {
  const d = String(value ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return d;
  if (/^639\d{9}$/.test(d)) return `0${d.slice(2)}`;
  if (/^9\d{9}$/.test(d)) return `0${d}`;
  return null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Which events go where, and who gets them. Admins edit; other staff see
 * the setup and what they personally receive.
 */
export default function NotificationSettings() {
  const { isAdmin, user } = useAuth();
  const settings = useLiveData(subscribeToNotifySettings, DEFAULTS);
  const users = useLiveData(isAdmin ? subscribeToUsers : null);
  const allPrefs = useLiveData(isAdmin ? subscribeToAllPrefs : null, {});
  const saved = settings.data;

  const [draft, setDraft] = useState(null); // unsaved edits; null = show saved
  const form = draft ?? saved;
  const edit = (fn) => setDraft((d) => fn(structuredClone(d ?? saved)));
  const dirty = draft !== null && !same(
    { c: draft.channels, r: draft.recipients, l: Number(draft.smsDailyLimit) },
    { c: saved.channels, r: saved.recipients, l: saved.smsDailyLimit },
  );

  const [save, saving] = useAction(saveNotifySettings, {
    success: "Notification settings saved.",
    onSuccess: () => setDraft(null),
  });

  const staff = users.data
    .filter((u) => (u.accountType ?? "staff") === "staff" && u.status === "active" && u.role !== ROLES.CUSTOMER)
    .sort((a, b) => ["administrator", "operator", "viewer"].indexOf(a.role) - ["administrator", "operator", "viewer"].indexOf(b.role));
  const choiceFor = (uid) => ({ ...DEFAULT_RECIPIENT, ...(form.recipients[uid] ?? {}) });
  const smsPeople = staff.filter((u) => choiceFor(u.id).sms && phMobile(u.phone)).length;
  const smsEvents = NOTIFY_EVENTS.filter((e) => form.channels[e.key].sms).map((e) => e.label);
  const mine = choiceFor(user?.uid);

  return (
    <Card
      title="Notification settings"
      subtitle="Which events reach people, and how. Web, email and Telegram are free; SMS uses prepaid Semaphore credits."
      actions={isAdmin && dirty ? <StatusBadge tone="warning" label="Unsaved" /> : null}
    >
      {settings.error && <Notice tone="error">{settings.error}</Notice>}
      {settings.loading ? (
        <Loading />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            save(form, user.uid);
          }}
        >
          <div className="table-wrap">
            <table className="table notify-grid">
              <thead>
                <tr>
                  <th>Event</th>
                  {CHANNELS.map((c) => (
                    <th key={c.key} className="center">
                      {c.label}
                      <span className="th-sub">{c.cost}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NOTIFY_EVENTS.map((e) => (
                  <tr key={e.key}>
                    <td>
                      <strong>{e.label}</strong>
                      <div className="muted fine-print">{e.hint}</div>
                    </td>
                    {CHANNELS.map((c) => (
                      <td key={c.key} className="center">
                        <input
                          type="checkbox"
                          aria-label={`${e.label} by ${c.label}`}
                          checked={form.channels[e.key][c.key]}
                          disabled={!isAdmin}
                          onChange={(ev) => edit((d) => ((d.channels[e.key][c.key] = ev.target.checked), d))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin ? (
            <>
              <div>
                <h4 className="subhead">Who gets them</h4>
                <p className="muted fine-print">
                  Email and SMS use each person's profile (Users page). New staff get the free channels (web, and
                  Telegram once they connect it) until you change it here. Each person can still switch off what you
                  give them under “My notifications”; that shows as “off by them”.
                </p>
                {users.loading ? (
                  <Loading />
                ) : (
                  <div className="table-wrap">
                    <table className="table notify-grid">
                      <thead>
                        <tr>
                          <th>Staff</th>
                          {CHANNELS.map((c) => (
                            <th key={c.key} className="center">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {staff.map((u) => {
                          const choice = choiceFor(u.id);
                          const phone = phMobile(u.phone);
                          const theirs = allPrefs.data[u.id] ?? {};
                          const cellNote = (key) => {
                            if (key === "telegram" && choice.telegram && !theirs.telegramChatId) return "not connected";
                            if (choice[key] && theirs[key] === false) return "off by them";
                            return null;
                          };
                          return (
                            <tr key={u.id}>
                              <td>
                                <strong>{u.nickname || u.email}</strong>{" "}
                                <span className="muted fine-print">{u.role}</span>
                                <div className="muted fine-print">
                                  {u.email}
                                  {" · "}
                                  {phone ?? <span className="text-warning">no PH mobile number</span>}
                                </div>
                              </td>
                              {CHANNELS.map((c) => (
                                <td key={c.key} className="center">
                                  {cellNote(c.key) && <span className="cell-note">{cellNote(c.key)}</span>}
                                  <input
                                    type="checkbox"
                                    aria-label={`${c.label} for ${u.nickname || u.email}`}
                                    checked={choice[c.key] && (c.key !== "sms" || Boolean(phone))}
                                    disabled={c.key === "sms" && !phone}
                                    title={c.key === "sms" && !phone ? "Add a mobile number on the Users page first" : undefined}
                                    onChange={(ev) =>
                                      edit((d) => {
                                        d.recipients[u.id] = { ...DEFAULT_RECIPIENT, ...(d.recipients[u.id] ?? {}), [c.key]: ev.target.checked };
                                        return d;
                                      })
                                    }
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="notify-limit">
                <div className="field">
                  <label htmlFor="sms-limit">SMS daily limit</label>
                  <input
                    id="sms-limit"
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    value={form.smsDailyLimit}
                    onChange={(e) => edit((d) => ((d.smsDailyLimit = e.target.value), d))}
                  />
                  <div className="field-hint">
                    Texts per day in total (Philippine time). After that, alerts still go by web, email and Telegram. 0 turns
                    SMS off.
                  </div>
                </div>
                <Notice tone="info" title="What SMS will cost">
                  {smsEvents.length === 0 || smsPeople === 0 ? (
                    "Nothing: no event or nobody is set to receive SMS."
                  ) : (
                    <>
                      Each alert texts {smsPeople} {smsPeople === 1 ? "person" : "people"} (≈ ₱
                      {(0.63 * smsPeople).toFixed(2)}) for: {smsEvents.join(", ")}. At most{" "}
                      {Number(form.smsDailyLimit) || 0} texts a day (≈ ₱{(0.63 * (Number(form.smsDailyLimit) || 0)).toFixed(2)}
                      ).
                    </>
                  )}
                </Notice>
              </div>

              <div className="button-row">
                <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
                  {saving ? "Saving…" : "Save settings"}
                </button>
                {dirty && (
                  <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
                    Discard changes
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="muted">
              An administrator gave you:{" "}
              {CHANNELS.filter((c) => mine[c.key])
                .map((c) => c.label.toLowerCase())
                .join(", ") || "nothing yet"}
              . Switch any of them off under “My notifications”; ask an administrator to add more.
            </p>
          )}
        </form>
      )}
    </Card>
  );
}

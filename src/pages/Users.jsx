import { Search, UserPlus, Users as UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, InfoGrid, PageHeader } from "../components/ui/Card";
import Modal from "../components/ui/Modal";
import { EmptyState, Loading, Notice } from "../components/ui/States";
import StatusBadge from "../components/ui/StatusBadge";
import { ACCOUNT_STATUS, ALL_ROLES, ROLES, STAFF_ROLES } from "../config/constants";
import { useAuth } from "../context/AuthContext";
import { useFeedback } from "../context/FeedbackContext";
import useAction from "../hooks/useAction";
import useLiveData from "../hooks/useLiveData";
import { getErrorMessage } from "../lib/errors";
import { formatDateTime } from "../lib/format";
import {
  createStaffAccount,
  subscribeToUsers,
  updateUserProfile,
  updateUserRole,
  updateUserStatus,
} from "../services/userService";

const TABS = [
  ["all", "All", () => true],
  ["staff", "Staff", (u) => STAFF_ROLES.includes(u.role)],
  ["customer", "Customers", (u) => u.role === ROLES.CUSTOMER],
  ["pending", "Pending", (u) => u.status === ACCOUNT_STATUS.PENDING],
  ["inactive", "Inactive", (u) => u.status === ACCOUNT_STATUS.INACTIVE],
];

const ROLE_HELP = {
  customer: "Shop only",
  viewer: "View dashboards & reports",
  operator: "Viewer + start/stop drying, inventory",
  administrator: "Everything, including users",
};

const displayName = (u) => u.nickname || u.email || "Unnamed user";

export default function Users() {
  const { user: me } = useAuth();
  const { data: users, loading, error } = useLiveData(subscribeToUsers);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matchesTab = TABS.find(([key]) => key === tab)[2];
    return users.filter(
      (u) =>
        matchesTab(u) &&
        (!term || [u.nickname, u.email, u.phone].some((v) => String(v ?? "").toLowerCase().includes(term))),
    );
  }, [users, tab, search]);

  const selected = users.find((u) => u.id === selectedId) ?? null;

  const [changeRole] = useAction((uid, role) => updateUserRole(uid, role), {
    confirm: (uid, role) => {
      const u = users.find((x) => x.id === uid);
      return {
        title: `Make ${displayName(u)} ${role === ROLES.ADMIN ? "an" : "a"} ${role}?`,
        message: `${ROLE_HELP[role]}. Takes effect immediately.`,
        confirmLabel: "Change role",
      };
    },
    success: "Role updated.",
  });

  const [changeStatus] = useAction((uid, status) => updateUserStatus(uid, status), {
    confirm: (uid, status) => {
      const u = users.find((x) => x.id === uid);
      const deactivate = status === ACCOUNT_STATUS.INACTIVE;
      return {
        title: `${deactivate ? "Deactivate" : "Activate"} ${displayName(u)}?`,
        message: deactivate
          ? "They will be signed out of every SmartChip page until reactivated."
          : "They will be able to use SmartChip with their current role.",
        confirmLabel: deactivate ? "Deactivate" : "Activate",
        danger: deactivate,
      };
    },
    success: (_r, _uid, status) => (status === ACCOUNT_STATUS.INACTIVE ? "Account deactivated." : "Account activated."),
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Accounts, roles and access."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add staff
          </button>
        }
      />

      <Card>
        <div className="toolbar">
          <div className="input-with-icon">
            <Search size={16} aria-hidden />
            <input
              className="input"
              placeholder="Search name, email or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users"
            />
          </div>
          <div className="segmented" role="tablist">
            {TABS.map(([key, label, test]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "is-active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
                <span className="count">{users.filter(test).length}</span>
              </button>
            ))}
          </div>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No users match">
            Try another search or tab.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th>Created</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const isMe = u.id === me?.uid;
                  const status = u.status || ACCOUNT_STATUS.ACTIVE;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-cell">
                          <strong>
                            {displayName(u)} {isMe && <span className="muted">(you)</span>}
                          </strong>
                          <span className="muted">{u.email}</span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="select select-compact"
                          value={u.role || ROLES.CUSTOMER}
                          onChange={(e) => changeRole(u.id, e.target.value)}
                          disabled={isMe}
                          aria-label={`Role for ${displayName(u)}`}
                          title={isMe ? "You can't change your own role" : ROLE_HELP[u.role]}
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <StatusBadge status={status} />
                      </td>
                      <td>{formatDateTime(u.lastLoginAt)}</td>
                      <td>{formatDateTime(u.createdAt)}</td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedId(u.id)}>
                            Details
                          </button>
                          {!isMe &&
                            (status === ACCOUNT_STATUS.ACTIVE ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => changeStatus(u.id, ACCOUNT_STATUS.INACTIVE)}
                              >
                                Deactivate
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => changeStatus(u.id, ACCOUNT_STATUS.ACTIVE)}
                              >
                                Activate
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* key: the form resets only when a different user is opened, not on every live update */}
      {selected && <UserDetails key={selected.id} user={selected} onClose={() => setSelectedId(null)} />}
      {adding && <AddStaff onClose={() => setAdding(false)} />}
    </div>
  );
}

function UserDetails({ user, onClose }) {
  const [form, setForm] = useState({ nickname: user.nickname ?? "", phone: user.phone ?? "" });
  const [save, saving] = useAction(updateUserProfile, { success: "Profile saved.", onSuccess: onClose });

  return (
    <Modal
      open
      title={displayName(user)}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <InfoGrid
        items={[
          { label: "Email", value: user.email || "--" },
          { label: "Role", value: user.role || "--" },
          { label: "Status", value: <StatusBadge status={user.status || "active"} /> },
          { label: "Created", value: formatDateTime(user.createdAt) },
          { label: "Last login", value: formatDateTime(user.lastLoginAt) },
          { label: "UID", value: <code className="uid">{user.id}</code> },
        ]}
      />
      <form
        id="user-form"
        className="form-grid modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(user.id, form);
        }}
      >
        <div className="field">
          <label htmlFor="u-name">Name</label>
          <input id="u-name" className="input" maxLength={100} value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="u-phone">Phone</label>
          <input id="u-phone" className="input" type="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
      </form>
    </Modal>
  );
}

function AddStaff({ onClose }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({ nickname: "", email: "", phone: "", role: ROLES.OPERATOR });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const result = await createStaffAccount(form);
      toast.success(
        result.resetEmailSent
          ? `Account created. ${result.email} has been emailed a link to set their password.`
          : `Account created, but the password email failed. Ask ${result.email} to use "Forgot password".`,
      );
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Add a staff account"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="staff-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Creating… (up to a minute)" : "Create account"}
          </button>
        </>
      }
    >
      <p className="muted">
        Creates the login and emails the person a link to choose their own password. The SmartChip notifier does
        this, so it can take up to a minute.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <form id="staff-form" className="form-grid modal-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="s-name">Name</label>
          <input id="s-name" name="nickname" className="input" maxLength={100} value={form.nickname} onChange={update} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="s-email">Email</label>
          <input id="s-email" name="email" type="email" className="input" value={form.email} onChange={update} required />
        </div>
        <div className="field">
          <label htmlFor="s-phone">Phone (optional)</label>
          <input id="s-phone" name="phone" type="tel" className="input" maxLength={30} value={form.phone} onChange={update} />
        </div>
        <div className="field">
          <label htmlFor="s-role">Role</label>
          <select id="s-role" name="role" className="select" value={form.role} onChange={update}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r} — {ROLE_HELP[r]}
              </option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  );
}

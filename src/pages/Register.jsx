import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import AuthLayout from "../components/layout/AuthLayout";
import { Notice } from "../components/ui/States";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../lib/errors";
import { registerCustomer } from "../services/authService";

const MIN_PASSWORD = 6;

export default function Register() {
  const { user, profile } = useAuth();
  const [form, setForm] = useState({ nickname: "", phone: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user && profile) return <Navigate to="/shop" replace />;

  const update = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError("");
  };

  async function submit(event) {
    event.preventDefault();
    if (!form.nickname.trim()) return setError("Please enter your name.");
    if (form.password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (form.password !== form.confirm) return setError("Passwords don't match.");

    setBusy(true);
    try {
      await registerCustomer(form);
      // AuthContext picks up the new profile and the redirect above kicks in.
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create your account."));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Customer account for the Agrigold Farm shop"
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      <form onSubmit={submit} className="auth-form" noValidate>
        <div className="field">
          <label htmlFor="nickname">Name</label>
          <input id="nickname" name="nickname" className="input" autoComplete="name" maxLength={100} value={form.nickname} onChange={update} disabled={busy} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone (optional)</label>
          <input id="phone" name="phone" type="tel" className="input" autoComplete="tel" maxLength={30} value={form.phone} onChange={update} disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className="input" autoComplete="email" value={form.email} onChange={update} disabled={busy} required />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="input" autoComplete="new-password" value={form.password} onChange={update} disabled={busy} required />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input id="confirm" name="confirm" type="password" className="input" autoComplete="new-password" value={form.confirm} onChange={update} disabled={busy} required />
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}

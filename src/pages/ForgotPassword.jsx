import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AuthLayout from "../components/layout/AuthLayout";
import { Notice } from "../components/ui/States";
import { getErrorMessage } from "../lib/errors";
import { sendPasswordReset } from "../services/authService";

/** Also how new staff set their first password (they're emailed a reset link). */
export default function ForgotPassword() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      // Don't reveal whether an account exists.
      if (err.code === "auth/user-not-found") setSent(true);
      else setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new password."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {sent ? (
        <Notice tone="success" title="Check your inbox">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. Check spam too.
        </Notice>
      ) : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={submit} className="auth-form">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required autoFocus />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}

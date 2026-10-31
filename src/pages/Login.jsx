import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import AuthLayout from "../components/layout/AuthLayout";
import { Notice } from "../components/ui/States";
import { homePathFor } from "../config/navigation";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../lib/errors";
import { signIn } from "../services/authService";

export default function Login() {
  const location = useLocation();
  const { user, profile, role, profileError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Already signed in (or just signed in) -> go where they were heading.
  // If that page isn't allowed for their role, RequireRole sends them home.
  if (user && profile) {
    const from = location.state?.from;
    const target = typeof from === "string" && from.startsWith("/") && from !== "/login" ? from : homePathFor(role);
    return <Navigate to={target} replace />;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to sign in."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your SmartChip account"
      footer={
        <>
          New customer? <Link to="/register">Create an account</Link>
        </>
      }
    >
      {(error || (user && profileError)) && <Notice tone="error">{error || profileError}</Notice>}

      <form onSubmit={submit} className="auth-form">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <div className="field-label-row">
            <label htmlFor="password">Password</label>
            <Link to="/forgot-password" state={{ email }} className="field-link">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || (user && !profile && !profileError)}>
          {busy || (user && !profile && !profileError) ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}

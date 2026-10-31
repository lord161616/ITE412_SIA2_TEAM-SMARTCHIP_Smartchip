import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ACCOUNT_STATUS } from "../../config/constants";
import { homePathFor } from "../../config/navigation";
import { useAuth } from "../../context/AuthContext";
import { signOutUser } from "../../services/authService";
import { Loading, Notice } from "../ui/States";

/**
 * Route guard: renders the child routes only for signed-in, active users
 * whose role is in `roles`. Firestore rules are the real security; this
 * just keeps people out of pages that would only show permission errors.
 */
export default function RequireRole({ roles }) {
  const { user, profile, role, status, loading, profileError } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Loading your account…" />;

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (profileError || !profile) {
    return (
      <BlockedAccount title="Couldn't load your SmartChip account">
        {profileError || "Your account profile is unavailable."}
      </BlockedAccount>
    );
  }

  if (status === ACCOUNT_STATUS.INACTIVE) {
    return (
      <BlockedAccount title="Account deactivated">
        Your SmartChip account has been deactivated. Please contact an administrator.
      </BlockedAccount>
    );
  }

  if (status !== ACCOUNT_STATUS.ACTIVE) {
    return (
      <BlockedAccount title="Account waiting for approval">
        An administrator needs to activate your account before you can use this page.
      </BlockedAccount>
    );
  }

  if (!roles.includes(role)) return <Navigate to={homePathFor(role)} replace />;

  return <Outlet />;
}

function BlockedAccount({ title, children }) {
  return (
    <div className="page narrow">
      <Notice
        tone="warning"
        title={title}
        action={
          <button type="button" className="btn btn-ghost" onClick={() => signOutUser()}>
            Sign out
          </button>
        }
      >
        {children}
      </Notice>
    </div>
  );
}

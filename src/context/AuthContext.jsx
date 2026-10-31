import { onAuthStateChanged } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ACCOUNT_STATUS, OPERATOR_ROLES, ROLES, STAFF_ROLES } from "../config/constants";
import { getErrorMessage } from "../lib/errors";
import { auth } from "../lib/firebase";
import { subscribeToUserProfile } from "../services/userService";

const AuthContext = createContext(null);

/** Right after sign-up the profile is still being written; wait this long before calling it missing. */
const PROFILE_GRACE_MS = 5000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  // Profile state is tagged with the uid it belongs to, so switching accounts
  // can never show the previous person's profile.
  const [feed, setFeed] = useState({ uid: null, profile: null, status: "loading", error: null });

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u ?? null)), []);

  // Live profile: role / status changes apply immediately, and a profile that
  // appears a moment after sign-up is picked up without a page refresh.
  useEffect(() => {
    if (!user) return undefined;
    const uid = user.uid;
    let graceTimer = null;

    const unsubscribe = subscribeToUserProfile(
      uid,
      (profile) => {
        clearTimeout(graceTimer);
        if (profile) {
          setFeed({ uid, profile, status: "ready", error: null });
          return;
        }
        graceTimer = setTimeout(() => {
          setFeed({
            uid,
            profile: null,
            status: "missing",
            error:
              "You're signed in, but there's no SmartChip profile for this account. Ask an administrator to set one up.",
          });
        }, PROFILE_GRACE_MS);
      },
      (error) => {
        console.error("Profile listener error:", error);
        setFeed({ uid, profile: null, status: "error", error: getErrorMessage(error, "Unable to load your account profile.") });
      },
    );

    return () => {
      clearTimeout(graceTimer);
      unsubscribe();
    };
  }, [user]);

  const value = useMemo(() => {
    const current = user && feed.uid === user.uid ? feed : null;
    const profile = current?.profile ?? null;
    const role = profile?.role ?? null;
    const isActive = profile?.status === ACCOUNT_STATUS.ACTIVE;
    const isStaffRole = STAFF_ROLES.includes(role) && (profile?.accountType ?? "staff") === "staff";

    return {
      user: user ?? null,
      profile,
      role,
      status: profile?.status ?? null,
      profileError: current?.error ?? null,
      loading: user === undefined || (Boolean(user) && (!current || current.status === "loading")),
      isSignedIn: Boolean(user),
      isActive,
      isStaff: isActive && isStaffRole,
      canOperate: isActive && isStaffRole && OPERATOR_ROLES.includes(role),
      isAdmin: isActive && isStaffRole && role === ROLES.ADMIN,
      isCustomer: role === ROLES.CUSTOMER,
    };
  }, [user, feed]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

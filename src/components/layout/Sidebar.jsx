import { LogIn, LogOut, X } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import logo from "../../assets/smartchip-logo-noname.png";
import { NAV_SECTIONS } from "../../config/navigation";
import { useAuth } from "../../context/AuthContext";
import { useDevice } from "../../context/DeviceContext";
import { useShop } from "../../context/ShopContext";
import { signOutUser } from "../../services/authService";
import StatusBadge from "../ui/StatusBadge";

export default function Sidebar({ open, onNavigate }) {
  const navigate = useNavigate();
  const { user, profile, role, isActive, isStaff, loading } = useAuth();
  const { connection, device } = useDevice();
  const { todoCount } = useShop();

  const canSee = (item) => item.roles === null || (isActive && item.roles.includes(role));
  const sections = NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter(canSee) })).filter(
    (s) => s.items.length > 0,
  );

  async function handleSignOut() {
    await signOutUser();
    onNavigate?.();
    navigate("/login", { replace: true });
  }

  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Main menu">
      <div className="sidebar-brand">
        <img src={logo} alt="SmartChip logo" />
        <div>
          <div className="sidebar-title">SmartChip</div>
          <div className="sidebar-subtitle">Mushroom Drying System</div>
        </div>
        <button type="button" className="icon-btn sidebar-close" onClick={onNavigate} aria-label="Close menu">
          <X size={20} />
        </button>
      </div>

      {isStaff && (
        <div className="sidebar-device">
          <span>Dehydrator</span>
          <StatusBadge
            status={connection === "online" && device?.status ? device.status : connection}
            dot
          />
        </div>
      )}

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div key={section.title} className="sidebar-section">
            <div className="sidebar-section-title">{section.title}</div>
            {section.items.map(({ label, path, icon: Icon }) => (
              <NavLink
                key={path}
                to={path === "/shop" && todoCount > 0 ? "/shop?tab=manage" : path}
                onClick={onNavigate}
                className={({ isActive: active }) => `sidebar-link ${active ? "is-active" : ""}`}
              >
                <Icon size={17} aria-hidden />
                <span>{label}</span>
                {path === "/shop" && todoCount > 0 && (
                  <span className="sidebar-count" title={`${todoCount} reservation(s) need you`}>
                    {todoCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {user ? (
          <>
            <div className="sidebar-user">
              <div className="sidebar-user-name">{profile?.nickname || user.email}</div>
              <div className="sidebar-user-meta">{loading ? "…" : role || "no profile"}</div>
            </div>
            <button type="button" className="btn btn-sidebar" onClick={handleSignOut}>
              <LogOut size={16} /> Sign out
            </button>
          </>
        ) : (
          <Link to="/login" className="btn btn-sidebar" onClick={onNavigate}>
            <LogIn size={16} /> Staff / customer sign in
          </Link>
        )}
      </div>
    </aside>
  );
}

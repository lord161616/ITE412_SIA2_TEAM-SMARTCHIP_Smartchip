import { Menu } from "lucide-react";
import { Suspense, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import logo from "../../assets/smartchip-logo-noname.png";
import { Loading } from "../ui/States";
import Sidebar from "./Sidebar";

export default function MainLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="app-shell">
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden />}
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />

      <div className="app-main">
        <header className="mobile-bar">
          <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <img src={logo} alt="" className="mobile-bar-logo" />
          <span className="mobile-bar-title">SmartChip</span>
        </header>

        <main className="app-content">
          {/* key: reset scroll + suspense per page */}
          <Suspense key={pathname} fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

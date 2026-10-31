import { Link } from "react-router-dom";
import logo from "../../assets/smartchip-logo.png";
import mushroomBg from "../../assets/mushroom-bg.png";

/** Split-screen frame shared by Login, Register and Forgot password. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <aside className="auth-visual" style={{ backgroundImage: `url(${mushroomBg})` }}>
        <div className="auth-visual-inner">
          <img src={logo} alt="SmartChip" className="auth-logo" />
          <p>Smart drying for premium oyster mushrooms.</p>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-card">
          <img src={logo} alt="" className="auth-logo-small" />
          <h1>{title}</h1>
          {subtitle && <p className="muted auth-subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
          <Link to="/shop" className="auth-back">
            ← Back to the shop
          </Link>
        </div>
      </main>
    </div>
  );
}

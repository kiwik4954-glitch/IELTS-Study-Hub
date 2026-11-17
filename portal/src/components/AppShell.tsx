import { useEffect } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
} from "react-router-dom";

import { BrandMark } from "./BrandMark";

const NAV_ITEMS = [
  { to: "/", label: "Home", end: true },
  { to: "/settings", label: "Settings", end: false },
  { to: "/help", label: "Help", end: false },
] as const;

const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/settings": "Settings",
  "/help": "Help & diagnostics",
};

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    document.title = `${PAGE_TITLES[pathname] ?? "Not found"} · IELTS Study Hub`;
  }, [pathname]);

  return null;
}

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-link nav-link--active" : "nav-link";
}

export function AppShell() {
  return (
    <div className="app-shell">
      <ScrollToTop />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="site-header">
        <div className="shell header-inner">
          <Link className="brand" to="/" aria-label="IELTS Study Hub — home">
            <BrandMark />
            <span className="brand-copy">
              <span className="brand-name">IELTS Study Hub</span>
              <span className="brand-meta">
                v{__PORTAL_VERSION__} · portal
              </span>
            </span>
          </Link>

          <nav className="site-nav" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={navClassName}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="main-content" className="shell page">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="shell footer-inner">
          <div>
            <p className="footer-title">IELTS Study Hub</p>
            <p>
              Local-first. No accounts, no telemetry. The Hub binds to loopback
              only.
            </p>
          </div>
          <div className="footer-links">
            <Link to="/settings">Settings</Link>
            <Link to="/help">Diagnostics &amp; help</Link>
            <span className="footer-version">Portal v{__PORTAL_VERSION__}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

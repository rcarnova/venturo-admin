"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type NavItem = { href: string; label: string; icon: string; matchPaths?: string[] };

const NAV_OPERATIVITA: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "◈" },
  { href: "/fatture", label: "Fatture Emesse", icon: "◻" },
  { href: "/fatture-ricevute", label: "Fatture Ricevute", icon: "◧" },
  { href: "/pipeline", label: "Pipeline", icon: "◬" },
  { href: "/anagrafiche", label: "Anagrafiche", icon: "◉", matchPaths: ["/anagrafiche", "/clienti", "/fornitori"] },
  { href: "/note-spese", label: "Note Spese", icon: "◫" },
];

const NAV_PIANIFICAZIONE: NavItem[] = [
  { href: "/cassa", label: "Cassa 90gg", icon: "◈", matchPaths: ["/cassa", "/scadenziario"] },
  { href: "/previsione", label: "Previsione", icon: "◭", matchPaths: ["/previsione", "/simulazione"] },
  { href: "/report-iva", label: "IVA", icon: "◐", matchPaths: ["/report-iva", "/scadenze-iva"] },
];

const MOBILE_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "◈" },
  { href: "/fatture", label: "Fatture", icon: "◻" },
  { href: "/cassa", label: "Cassa", icon: "◑", matchPaths: ["/cassa", "/scadenziario"] },
  { href: "/previsione", label: "Previsione", icon: "◭", matchPaths: ["/previsione", "/simulazione"] },
  { href: "/report-iva", label: "IVA", icon: "◐", matchPaths: ["/report-iva", "/scadenze-iva"] },
];

function isActive(item: NavItem, pathname: string) {
  if (item.matchPaths) return item.matchPaths.includes(pathname);
  return pathname === item.href;
}

function NavSection({ label, items, pathname, badges }: {
  label: string;
  items: NavItem[];
  pathname: string;
  badges?: Record<string, number>;
}) {
  return (
    <>
      <div className="sidebar-section-label">{label}</div>
      {items.map((item) => {
        const count = badges?.[item.href];
        return (
          <Link key={item.href} href={item.href} className={`sidebar-link ${isActive(item, pathname) ? "active" : ""}`}>
            <span className="sidebar-icon">{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {count ? (
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.55rem",
                fontWeight: 600,
                background: "rgba(255,60,60,0.12)",
                color: "#ff4444",
                borderRadius: "8px",
                padding: "0.1rem 0.4rem",
                minWidth: "1.2rem",
                textAlign: "center",
                lineHeight: 1.6,
              }}>
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}

export default function Sidebar({ username, badges }: { username?: string; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <nav className="mobile-nav">
        {MOBILE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item ${isActive(item, pathname) ? "active" : ""}`}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <aside className="sidebar">
        {/* Logo */}
        <div style={{ padding: "1.25rem 1rem 1rem", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <svg width="10" height="16" viewBox="0 0 10 16" fill="none" aria-hidden>
              <line x1="8" y1="1" x2="2" y2="15" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <div style={{ fontFamily: "var(--font-grotesk)", fontWeight: 700, fontSize: "0.95rem", letterSpacing: "-0.03em", color: "var(--text)" }}>
              Venturo
            </div>
          </div>
          <div className="v-eyebrow" style={{ marginTop: "3px", paddingLeft: "14px" }}>
            Admin Console
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "0.75rem 0", flex: 1 }}>
          <NavSection label="Operatività" items={NAV_OPERATIVITA} pathname={pathname} badges={badges} />
          <NavSection label="Pianificazione" items={NAV_PIANIFICAZIONE} pathname={pathname} badges={badges} />
        </nav>

        {/* Footer */}
        <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid var(--border)" }}>
          {username && (
            <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--ink-300)", textTransform: "capitalize" }}>
                {username}
              </span>
              <button
                onClick={handleLogout}
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0, letterSpacing: "0.06em", textTransform: "uppercase", transition: "color var(--dur-fast) var(--ease-out)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--ink-100)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
              >
                Esci →
              </button>
            </div>
          )}
          <div className="v-eyebrow" style={{ color: "var(--muted-2)" }}>
            Studio Miller · {new Date().getFullYear()}
          </div>
        </div>
      </aside>
    </>
  );
}

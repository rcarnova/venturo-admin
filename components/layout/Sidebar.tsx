"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_GESTIONE = [
  { href: "/", label: "Dashboard", icon: "◈" },
  { href: "/fatture", label: "Fatture Emesse", icon: "◻" },
  { href: "/fatture-ricevute", label: "Fatture Ricevute", icon: "◧" },
  { href: "/clienti", label: "Clienti", icon: "◎" },
  { href: "/fornitori", label: "Fornitori", icon: "◉" },
  { href: "/note-spese", label: "Note Spese", icon: "◫" },
  { href: "/pipeline", label: "Pipeline", icon: "◬" },
];

const NAV_ANALISI = [
  { href: "/scadenziario", label: "Scadenziario", icon: "◷" },
  { href: "/cassa", label: "Proiezione Cassa", icon: "◈" },
  { href: "/scadenze-iva", label: "Scadenze IVA", icon: "◑" },
  { href: "/report-iva", label: "Report IVA", icon: "◐" },
];

function NavSection({ label, items, pathname }: { label: string; items: typeof NAV_GESTIONE; pathname: string }) {
  return (
    <>
      <div className="sidebar-section-label">{label}</div>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={`sidebar-link ${pathname === item.href ? "active" : ""}`}>
          <span className="sidebar-icon">{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </>
  );
}

const MOBILE_NAV = [
  { href: "/", label: "Home", icon: "◈" },
  { href: "/fatture", label: "Fatture", icon: "◻" },
  { href: "/pipeline", label: "Pipeline", icon: "◬" },
  { href: "/scadenziario", label: "Agenda", icon: "◷" },
  { href: "/cassa", label: "Cassa", icon: "◑" },
];

export default function Sidebar({ username }: { username?: string }) {
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
          className={`mobile-nav-item ${pathname === item.href ? "active" : ""}`}
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
          {/* Slash motif */}
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
        <NavSection label="Gestione" items={NAV_GESTIONE} pathname={pathname} />
        <NavSection label="Analisi" items={NAV_ANALISI} pathname={pathname} />
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderTop: "1px solid var(--border)",
        }}
      >
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

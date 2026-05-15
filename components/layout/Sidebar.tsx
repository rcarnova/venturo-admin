"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard", icon: "◈" },
  { href: "/fatture", label: "Fatture", icon: "◻" },
  { href: "/scadenze-iva", label: "Scadenze IVA", icon: "◷" },
  { href: "/fornitori", label: "Fornitori", icon: "◉" },
  { href: "/spese", label: "Spese Operative", icon: "◈" },
  { href: "/note-spese", label: "Note Spese", icon: "◫" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div
        style={{
          padding: "1.5rem 1.25rem 1rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-grotesk)",
            fontWeight: 700,
            fontSize: "1rem",
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          Venturo
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.6rem",
            color: "var(--muted)",
            marginTop: "2px",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          Admin Console
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "0.75rem 0", flex: 1 }}>
        <div
          style={{
            padding: "0.5rem 1rem 0.25rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.6rem",
            color: "var(--muted-2)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Gestione
        </div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link ${pathname === item.href ? "active" : ""}`}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                opacity: 0.6,
                width: "1rem",
                textAlign: "center",
              }}
            >
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.6rem",
            color: "var(--muted-2)",
            letterSpacing: "0.03em",
          }}
        >
          Studio Miller / Venturo
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.6rem",
            color: "var(--muted-2)",
            marginTop: "2px",
          }}
        >
          © {new Date().getFullYear()}
        </div>
      </div>
    </aside>
  );
}

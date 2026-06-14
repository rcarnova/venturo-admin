import Link from "next/link";

type TabItem = { href: string; label: string; active: boolean };

export function TabNav({ tabs }: { tabs: TabItem[] }) {
  return (
    <div style={{
      display: "flex",
      borderBottom: "1px solid var(--border)",
      marginBottom: "1.75rem",
      gap: 0,
    }}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.62rem",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            padding: "0.55rem 1.1rem",
            textDecoration: "none",
            color: t.active ? "var(--text)" : "var(--muted)",
            borderBottom: t.active ? "1.5px solid var(--accent)" : "1.5px solid transparent",
            marginBottom: "-1px",
            transition: "color 0.15s ease",
          }}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

import { DB, queryAll, mapNotaSpese } from "@/lib/notion";
import { formatEuro, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

const OWNER_COLORS: Record<string, string> = {
  Rosario: "#e1ff00",
  Massimo: "#00c8ff",
  Arianna: "#ff60a0",
};

export default async function NoteSpeseePage({
  searchParams,
}: {
  searchParams: { status?: string; owner?: string };
}) {
  const filter = searchParams.status
    ? { property: "Status rimborso", select: { equals: searchParams.status } }
    : undefined;

  const pages = await queryAll(DB.NOTE_SPESE, filter as never);
  let note = pages.map(mapNotaSpese);

  if (searchParams.owner) {
    note = note.filter((n) => n.owner === searchParams.owner);
  }

  // Totali per owner
  const totaliOwner: Record<string, number> = {};
  for (const n of note) {
    if (n.statusRimborso === "Da rimborsare") {
      totaliOwner[n.owner] = (totaliOwner[n.owner] ?? 0) + n.importo;
    }
  }

  return (
    <div>
      <PageHeader
        title="Note Spese"
        subtitle={`${note.length} voci · rimborsi e spese personali`}
      />

      {/* Owner summary */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {Object.entries(totaliOwner).map(([owner, tot]) => (
          <div
            key={owner}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: "var(--muted)",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              padding: "0.4rem 0.75rem",
            }}
          >
            <span style={{ color: OWNER_COLORS[owner] ?? "var(--accent)" }}>
              {owner}
            </span>
            {" da rimborsare: "}
            <span className="num" style={{ color: "var(--text)" }}>
              {formatEuro(tot)}
            </span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {[null, "Da rimborsare", "Rimborsato"].map((s) => (
          <a
            key={s ?? "all"}
            href={s ? `/note-spese?status=${encodeURIComponent(s)}` : "/note-spese"}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem",
              padding: "0.3rem 0.75rem",
              borderRadius: "3px",
              border: "1px solid var(--border)",
              color: (!searchParams.status && !s) || searchParams.status === s ? "var(--accent)" : "var(--muted)",
              background: (!searchParams.status && !s) || searchParams.status === s ? "rgba(225,255,0,0.06)" : "transparent",
              textDecoration: "none",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {s ?? "Tutte"}
          </a>
        ))}
        <div style={{ width: "1px", background: "var(--border)", margin: "0 0.25rem" }} />
        {["Rosario", "Massimo", "Arianna"].map((owner) => (
          <a
            key={owner}
            href={
              searchParams.owner === owner
                ? "/note-spese"
                : `/note-spese?owner=${owner}${searchParams.status ? `&status=${encodeURIComponent(searchParams.status)}` : ""}`
            }
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem",
              padding: "0.3rem 0.75rem",
              borderRadius: "3px",
              border: `1px solid ${searchParams.owner === owner ? OWNER_COLORS[owner] + "40" : "var(--border)"}`,
              color: searchParams.owner === owner ? OWNER_COLORS[owner] : "var(--muted)",
              background: searchParams.owner === owner ? OWNER_COLORS[owner] + "10" : "transparent",
              textDecoration: "none",
            }}
          >
            {owner}
          </a>
        ))}
      </div>

      <div
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        <table className="admin-table">
          <thead>
            <tr>
              <th>Descrizione</th>
              <th>Owner</th>
              <th>Data</th>
              <th>Importo</th>
              <th>Categoria</th>
              <th>Status rimborso</th>
              <th>Protocollo ✓</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {note.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                  Nessuna nota spese trovata
                </td>
              </tr>
            )}
            {note.map((n) => (
              <tr key={n.id}>
                <td>
                  <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{n.descrizione}</span>
                </td>
                <td>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: OWNER_COLORS[n.owner] ?? "var(--text)",
                    }}
                  >
                    {n.owner}
                  </span>
                </td>
                <td>
                  <span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {formatDate(n.data)}
                  </span>
                </td>
                <td>
                  <span className="num">{formatEuro(n.importo)}</span>
                </td>
                <td>
                  <span className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                    {n.categoria}
                  </span>
                </td>
                <td>
                  <StatusBadge status={n.statusRimborso} />
                </td>
                <td>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      color: n.protocolloLunedi ? "#00c864" : "var(--muted-2)",
                    }}
                  >
                    {n.protocolloLunedi ? "✓" : "·"}
                  </span>
                </td>
                <td>
                  {n.file ? (
                    <a
                      href={n.file}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--accent)", textDecoration: "none" }}
                    >
                      FILE →
                    </a>
                  ) : (
                    <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

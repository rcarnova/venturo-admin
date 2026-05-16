import { DB, queryAll, mapFatturaRicevuta, mapFornitore } from "@/lib/notion";
import { formatEuro, formatDate, isUrgent } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

async function getFattureRicevute(status?: string) {
  const [pages, fornitori] = await Promise.all([
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.FORNITORI),
  ]);
  const fornitoriMap = new Map(fornitori.map((p) => [p.id, mapFornitore(p).nome]));

  const all = pages.map((page) => {
    const f = mapFatturaRicevuta(page);
    if (f.fornitore) f.fornitore = fornitoriMap.get(f.fornitore) ?? f.fornitore;
    return f;
  }).sort((a, b) => {
    // Ordina per scadenza ascendente (le più urgenti prima), senza scadenza in fondo
    if (!a.scadenza) return 1;
    if (!b.scadenza) return -1;
    return new Date(a.scadenza).getTime() - new Date(b.scadenza).getTime();
  });
  return status ? all.filter((f) => f.status === status) : all;
}

export default async function FattureRicevutePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const fatture = await getFattureRicevute(searchParams.status);

  const totale = fatture.reduce((s, f) => s + f.importo, 0);
  const ricevute = fatture.filter((f) => f.status === "Ricevuta");
  const inScadenza = fatture.filter((f) => isUrgent(f.scadenza, 15));

  const statuses = Array.from(new Set(fatture.map((f) => f.status).filter(Boolean)));

  return (
    <div>
      <PageHeader
        title="Fatture Ricevute"
        subtitle={`${fatture.length} fatture da fornitori`}
      />

      {/* Alert scadenze */}
      {inScadenza.length > 0 && !searchParams.status && (
        <div
          style={{
            background: "rgba(255,180,0,0.08)",
            border: "1px solid rgba(255,180,0,0.25)",
            borderRadius: "6px",
            padding: "0.75rem 1.25rem",
            marginBottom: "1.5rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.72rem",
            color: "#ffb400",
          }}
        >
          ⚠ {inScadenza.length} fattura{inScadenza.length > 1 ? "e" : ""} in scadenza entro 15 giorni
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <a
          href="/fatture-ricevute"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            padding: "0.3rem 0.75rem",
            borderRadius: "3px",
            border: "1px solid var(--border)",
            color: !searchParams.status ? "var(--accent)" : "var(--muted)",
            background: !searchParams.status ? "rgba(225,255,0,0.06)" : "transparent",
            textDecoration: "none",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Tutte
        </a>
        {statuses.map((s) => (
          <a
            key={s}
            href={`/fatture-ricevute?status=${encodeURIComponent(s!)}`}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem",
              padding: "0.3rem 0.75rem",
              borderRadius: "3px",
              border: "1px solid var(--border)",
              color: searchParams.status === s ? "var(--accent)" : "var(--muted)",
              background: searchParams.status === s ? "rgba(225,255,0,0.06)" : "transparent",
              textDecoration: "none",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {s}
          </a>
        ))}
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
          Totale: <span className="num" style={{ color: "var(--text)" }}>{formatEuro(totale)}</span>
        </div>
        {ricevute.length > 0 && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
            Ricevute da pagare:{" "}
            <span className="num" style={{ color: "#ffb400" }}>
              {formatEuro(ricevute.reduce((s, f) => s + f.importo, 0))}
            </span>
          </div>
        )}
      </div>

      {/* Table */}
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
              <th>Fattura</th>
              <th>Fornitore</th>
              <th>Data</th>
              <th>Scadenza</th>
              <th>Importo</th>
              <th>Status</th>
              <th>Progetto</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {fatture.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                  Nessuna fattura trovata
                </td>
              </tr>
            )}
            {fatture.map((f) => {
              const urgente = isUrgent(f.scadenza, 15);
              return (
                <tr key={f.id}>
                  <td>
                    <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{f.nome}</span>
                  </td>
                  <td>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
                      {f.fornitore ?? "—"}
                    </span>
                  </td>
                  <td>
                    <span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {formatDate(f.dataFattura)}
                    </span>
                  </td>
                  <td>
                    <span
                      className="num"
                      style={{
                        fontSize: "0.75rem",
                        color: urgente ? "#ffb400" : "var(--muted)",
                        fontWeight: urgente ? 600 : 400,
                      }}
                    >
                      {formatDate(f.scadenza)}
                      {urgente && " ⚠"}
                    </span>
                  </td>
                  <td>
                    <span className="num">{formatEuro(f.importo)}</span>
                  </td>
                  <td>
                    {f.status ? (
                      <StatusBadge status={f.status} />
                    ) : (
                      <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>—</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>
                      {f.progetto ?? "—"}
                    </span>
                  </td>
                  <td>
                    {f.fileFattura ? (
                      <a
                        href={f.fileFattura}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.65rem",
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        PDF →
                      </a>
                    ) : (
                      <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Ricevuta": "badge-warning",
    "Pagata": "badge-success",
    "In ritardo": "badge-error",
  };
  return <span className={`badge ${map[status] ?? "badge-neutral"}`}>{status}</span>;
}

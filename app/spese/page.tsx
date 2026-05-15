import { DB, queryAll, mapSpesa } from "@/lib/notion";
import { formatEuro, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

export default async function SpesePage({
  searchParams,
}: {
  searchParams: { pagamento?: string; categoria?: string };
}) {
  const filter = searchParams.pagamento
    ? { property: "Pagamento", select: { equals: searchParams.pagamento } }
    : undefined;

  const pages = await queryAll(DB.SPESE, filter as never);
  const spese = pages.map(mapSpesa);

  const totale = spese.reduce((s, sp) => s + sp.importo, 0);
  const daPagare = spese.filter((s) => s.pagamento === "Da pagare");

  return (
    <div>
      <PageHeader
        title="Spese Operative"
        subtitle={`${spese.length} spese${searchParams.pagamento ? ` · ${searchParams.pagamento}` : ""}`}
      />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {[null, "Da pagare", "Pagato"].map((p) => (
          <a
            key={p ?? "all"}
            href={p ? `/spese?pagamento=${encodeURIComponent(p)}` : "/spese"}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem",
              padding: "0.3rem 0.75rem",
              borderRadius: "3px",
              border: "1px solid var(--border)",
              color: (!searchParams.pagamento && !p) || searchParams.pagamento === p ? "var(--accent)" : "var(--muted)",
              background: (!searchParams.pagamento && !p) || searchParams.pagamento === p ? "rgba(225,255,0,0.06)" : "transparent",
              textDecoration: "none",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {p ?? "Tutte"}
          </a>
        ))}
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
          Totale: <span className="num" style={{ color: "var(--text)" }}>{formatEuro(totale)}</span>
        </div>
        {daPagare.length > 0 && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
            Da pagare:{" "}
            <span className="num" style={{ color: "#ffb400" }}>
              {formatEuro(daPagare.reduce((s, sp) => s + sp.importo, 0))}
            </span>
          </div>
        )}
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
              <th>Spesa</th>
              <th>Categoria</th>
              <th>Data</th>
              <th>Importo</th>
              <th>Netto</th>
              <th>Frequenza</th>
              <th>Prossimo rinnovo</th>
              <th>Pagamento</th>
              <th>Status</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {spese.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                  Nessuna spesa trovata
                </td>
              </tr>
            )}
            {spese.map((s) => (
              <tr key={s.id}>
                <td>
                  <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{s.nome}</span>
                </td>
                <td>
                  <span className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                    {s.categoria}
                  </span>
                </td>
                <td>
                  <span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {formatDate(s.data)}
                  </span>
                </td>
                <td>
                  <span className="num">{formatEuro(s.importo)}</span>
                </td>
                <td>
                  <span className="num" style={{ color: s.percentualeRitenuta ? "#ffb400" : "var(--muted)" }}>
                    {s.nettoPagato !== null ? formatEuro(s.nettoPagato) : "—"}
                  </span>
                </td>
                <td>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                    {s.frequenza ?? "—"}
                  </span>
                </td>
                <td>
                  <span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {formatDate(s.prossimoRinnovo)}
                  </span>
                </td>
                <td>
                  <StatusBadge status={s.pagamento} />
                </td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>
                  {s.fileFattura ? (
                    <a
                      href={s.fileFattura}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--accent)", textDecoration: "none" }}
                    >
                      PDF →
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

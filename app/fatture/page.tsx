import { DB, queryAll, mapFattura } from "@/lib/notion";
import { formatEuro, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

async function getFatture(status?: string) {
  const pages = await queryAll(DB.FATTURE);
  const all = pages.map(mapFattura);
  return status ? all.filter((f) => f.status === status) : all;
}

export default async function FatturePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const fatture = await getFatture(searchParams.status);

  const totaleImporti = fatture.reduce((s, f) => s + f.importo, 0);
  const totaleIVA = fatture.reduce((s, f) => s + f.iva22, 0);

  return (
    <div>
      <PageHeader
        title="Fatture"
        subtitle={`${fatture.length} record${searchParams.status ? ` · filtro: ${searchParams.status}` : ""}`}
      />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {[null, "Da inviare", "Inviata", "Pagata", "In ritardo"].map((s) => (
          <a
            key={s ?? "all"}
            href={s ? `/fatture?status=${encodeURIComponent(s)}` : "/fatture"}
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
      </div>

      {/* Summary */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: "var(--muted)",
          }}
        >
          Totale:{" "}
          <span className="num" style={{ color: "var(--text)" }}>
            {formatEuro(totaleImporti)}
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: "var(--muted)",
          }}
        >
          IVA:{" "}
          <span className="num" style={{ color: "var(--accent)" }}>
            {formatEuro(totaleIVA)}
          </span>
        </div>
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
              <th>Importo</th>
              <th>IVA 22%</th>
              <th>Status</th>
              <th>Trimestre IVA</th>
              <th>Data</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {fatture.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                  Nessuna fattura trovata
                </td>
              </tr>
            )}
            {fatture.map((f) => (
              <tr key={f.id}>
                <td>
                  <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{f.nome}</span>
                </td>
                <td>
                  <span className="num">{formatEuro(f.importo)}</span>
                </td>
                <td>
                  <span className="num" style={{ color: "var(--accent)" }}>
                    {formatEuro(f.iva22)}
                  </span>
                </td>
                <td>
                  <StatusBadge status={f.status} />
                </td>
                <td>
                  {f.trimestreIVA ? (
                    <span
                      className="badge badge-neutral"
                      style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem" }}
                    >
                      {f.trimestreIVA}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>—</span>
                  )}
                </td>
                <td>
                  <span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {formatDate(f.createdAt)}
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
                        letterSpacing: "0.04em",
                      }}
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

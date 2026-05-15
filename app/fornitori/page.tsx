import { DB, queryAll, mapFornitore } from "@/lib/notion";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

export default async function FornitoriPage() {
  const pages = await queryAll(DB.FORNITORI);
  const fornitori = pages.map(mapFornitore);

  return (
    <div>
      <PageHeader
        title="Fornitori"
        subtitle={`${fornitori.length} fornitori attivi`}
      />

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
              <th>Nome</th>
              <th>Categoria</th>
              <th>P.IVA</th>
              <th>Con IVA</th>
              <th>Ritenuta</th>
              <th>% Rit.</th>
              <th>Email</th>
              <th>Status</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {fornitori.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                  Nessun fornitore
                </td>
              </tr>
            )}
            {fornitori.map((f) => (
              <tr key={f.id}>
                <td>
                  <span style={{ fontWeight: 500 }}>{f.nome}</span>
                </td>
                <td>
                  <span
                    className="badge badge-neutral"
                    style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}
                  >
                    {f.categoria}
                  </span>
                </td>
                <td>
                  <span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    {f.pIVA ?? "—"}
                  </span>
                </td>
                <td>
                  <Checkbox value={f.conIVA} />
                </td>
                <td>
                  <Checkbox value={f.ritenuta} />
                </td>
                <td>
                  {f.percentualeRitenuta ? (
                    <span className="num" style={{ color: "#ffb400" }}>
                      {f.percentualeRitenuta}%
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted-2)" }}>—</span>
                  )}
                </td>
                <td>
                  {f.email ? (
                    <a
                      href={`mailto:${f.email}`}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        color: "var(--muted)",
                        textDecoration: "none",
                      }}
                    >
                      {f.email}
                    </a>
                  ) : (
                    <span style={{ color: "var(--muted-2)" }}>—</span>
                  )}
                </td>
                <td>
                  <StatusBadge status={f.status} />
                </td>
                <td>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.7rem",
                      color: "var(--muted)",
                      maxWidth: "200px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                    title={f.note ?? ""}
                  >
                    {f.note ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Checkbox({ value }: { value: boolean }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.8rem",
        color: value ? "#00c864" : "var(--muted-2)",
      }}
    >
      {value ? "✓" : "×"}
    </span>
  );
}

import { DB, queryAll, mapFattura, mapScadenza } from "@/lib/notion";
import { formatEuro, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import ScadenzaUpdateForm from "./ScadenzaUpdateForm";

export const revalidate = 0;

async function getData() {
  const [scadenzePages, fatturePages] = await Promise.all([
    queryAll(DB.SCADENZE_IVA),
    queryAll(DB.FATTURE),
  ]);
  const scadenze = scadenzePages
    .map(mapScadenza)
    .sort((a, b) => {
      const [qa, ya] = a.trimestre.split(" ");
      const [qb, yb] = b.trimestre.split(" ");
      return Number(ya) - Number(yb) || Number(qa[1]) - Number(qb[1]);
    });
  const fatture = fatturePages.map(mapFattura);
  return { scadenze, fatture };
}

export default async function ScadenzeIVAPage() {
  const { scadenze, fatture } = await getData();

  // Calcola IVA per trimestre dalle fatture pagate
  const ivaPerTrimestre: Record<string, number> = {};
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre[f.trimestreIVA] =
        (ivaPerTrimestre[f.trimestreIVA] ?? 0) + f.iva22;
    }
  }

  return (
    <div>
      <PageHeader
        title="Scadenze IVA"
        subtitle="Regime di cassa — IVA sull'incassato"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {scadenze.map((s) => {
          const ivaCalcolata = ivaPerTrimestre[s.trimestre] ?? 0;
          const fattureDelTrimestre = fatture.filter(
            (f) => f.trimestreIVA === s.trimestre && f.status === "Pagata"
          );

          return (
            <div
              key={s.id}
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              {/* Header scadenza */}
              <div
                style={{
                  padding: "1rem 1.5rem",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      color: "var(--accent)",
                    }}
                  >
                    {s.trimestre}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.7rem",
                      color: "var(--muted)",
                    }}
                  >
                    {s.periodo}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.7rem",
                      color: "var(--muted)",
                    }}
                  >
                    Scadenza:{" "}
                    <span style={{ color: "var(--text)" }}>
                      {formatDate(s.scadenzaVersamento)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.7rem",
                      color: "var(--muted)",
                    }}
                  >
                    IVA calcolata:{" "}
                    <span className="num" style={{ color: "var(--accent)" }}>
                      {formatEuro(ivaCalcolata)}
                    </span>
                  </div>
                  {s.totaleIVA !== null && (
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        color: "var(--muted)",
                      }}
                    >
                      IVA registrata:{" "}
                      <span className="num" style={{ color: "#00c864" }}>
                        {formatEuro(s.totaleIVA)}
                      </span>
                    </div>
                  )}
                  <StatusBadge status={s.status} />
                </div>
              </div>

              {/* Fatture del trimestre */}
              {fattureDelTrimestre.length > 0 && (
                <div style={{ padding: "0.75rem 1.5rem" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.6rem",
                      color: "var(--muted-2)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Fatture pagate in questo trimestre
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {fattureDelTrimestre.map((f) => (
                      <span
                        key={f.id}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.65rem",
                          color: "var(--text)",
                          background: "var(--surface-3)",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "3px",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {f.nome}{" "}
                        <span style={{ color: "var(--accent)" }}>
                          +{formatEuro(f.iva22)}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Update form */}
              <div style={{ padding: "0.75rem 1.5rem", borderTop: "1px solid var(--border)" }}>
                <ScadenzaUpdateForm
                  scadenza={s}
                  ivaCalcolata={ivaCalcolata}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Da calcolare": "badge-warning",
    Calcolata: "badge-accent",
    Versata: "badge-success",
    "In ritardo": "badge-error",
  };
  return <span className={`badge ${map[status] ?? "badge-neutral"}`}>{status}</span>;
}

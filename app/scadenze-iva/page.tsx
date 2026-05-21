import { DB, queryAll, mapFattura } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Fattura, TrimestreIVA } from "@/lib/types";

export const revalidate = 0;

function buildScadenze(fatture: Fattura[]) {
  const map = new Map<string, Fattura[]>();
  for (const f of fatture) {
    if (!f.trimestreIVA) continue;
    if (!map.has(f.trimestreIVA)) map.set(f.trimestreIVA, []);
    map.get(f.trimestreIVA)!.push(f);
  }

  const today = new Date();
  return Array.from(map.entries())
    .map(([trimestre, fatt]) => {
      const scadenzaStr = scadenzaVersamentoIVA(trimestre);
      const [d, m, y] = scadenzaStr.split("/").map(Number);
      const scadenzaDate = new Date(y, m - 1, d);
      const versata = scadenzaDate < today;
      const diffDays = (scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      const urgent = !versata && diffDays <= 15;
      const fattPagate = fatt.filter((f) => f.status === "Pagata");
      const fattAltro = fatt.filter((f) => f.status !== "Pagata");
      const totaleIVA = fattPagate.reduce((s, f) => s + f.iva22, 0);
      return {
        trimestre: trimestre as TrimestreIVA,
        periodo: periodoTrimestre(trimestre),
        scadenzaStr,
        scadenzaDate,
        versata,
        urgent,
        totaleIVA,
        fattPagate,
        fattAltro,
      };
    })
    .sort((a, b) => a.scadenzaDate.getTime() - b.scadenzaDate.getTime());
}

export default async function ScadenzeIVAPage() {
  const pages = await queryAll(DB.FATTURE);
  const fatture = pages.map(mapFattura);
  const scadenze = buildScadenze(fatture);

  return (
    <div>
      <PageHeader
        title="Scadenze IVA"
        subtitle="Regime di cassa — IVA sull'incassato"
      />

      {scadenze.length === 0 && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--muted)", padding: "2rem 0" }}>
          Nessuna fattura con data di incasso registrata.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {scadenze.map((s) => (
          <div
            key={s.trimestre}
            style={{
              background: s.urgent ? "rgba(255,60,60,0.02)" : "var(--surface-2)",
              border: `1px solid ${s.urgent ? "rgba(255,60,60,0.3)" : "var(--border)"}`,
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            {/* Header */}
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
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.9rem", color: "var(--accent)" }}>
                  {s.trimestre}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                  {s.periodo}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                  Scadenza:{" "}
                  <span style={{ color: s.urgent ? "#ff4444" : "var(--text)" }}>{s.scadenzaStr}</span>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                  IVA da versare:{" "}
                  <span className="num" style={{ color: s.totaleIVA > 0 ? "var(--accent)" : "var(--muted-2)" }}>
                    {s.totaleIVA > 0 ? formatEuro(s.totaleIVA) : "—"}
                  </span>
                </div>
                <span
                  className={`badge ${
                    s.versata ? "badge-success" : s.urgent ? "badge-error" : "badge-warning"
                  }`}
                >
                  {s.versata ? "Versata" : "Da versare"}
                </span>
              </div>
            </div>

            {/* Fatture incassate */}
            {s.fattPagate.length > 0 && (
              <div style={{ padding: "0.75rem 1.5rem" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                  Fatture incassate
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {s.fattPagate.map((f) => (
                    <span
                      key={f.id}
                      style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--text)", background: "var(--surface-3)", padding: "0.2rem 0.5rem", borderRadius: "3px", border: "1px solid var(--border)" }}
                    >
                      {f.nome}{" "}
                      <span style={{ color: "var(--accent)" }}>+{formatEuro(f.iva22)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Fatture non ancora incassate */}
            {s.fattAltro.length > 0 && (
              <div
                style={{
                  padding: "0.75rem 1.5rem",
                  borderTop: s.fattPagate.length > 0 ? "1px solid var(--border)" : undefined,
                }}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                  Non ancora incassate — IVA non dovuta
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {s.fattAltro.map((f) => (
                    <span
                      key={f.id}
                      style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", background: "var(--surface-3)", padding: "0.2rem 0.5rem", borderRadius: "3px", border: "1px solid var(--border)" }}
                    >
                      {f.nome}{" "}
                      <span style={{ color: "var(--muted-2)" }}>{formatEuro(f.iva22)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

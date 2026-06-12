import { DB, queryAll, mapFattura, mapFatturaRicevuta } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre, calcolaIVACreditoPerTrimestre } from "@/lib/utils";
import { COSTI_RICORRENTI } from "@/lib/config";
import { PageHeader } from "@/components/shared/PageHeader";
import type { TrimestreIVA } from "@/lib/types";

export const revalidate = 0;

const ANNO = new Date().getFullYear();

async function getData() {
  const [fatturePages, ricevutePages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
  ]);
  const fatture = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);

  // IVA a credito per trimestre (fatture ricevute + costi ricorrenti)
  const ivaCreditoMap = calcolaIVACreditoPerTrimestre(ricevute, COSTI_RICORRENTI, ANNO);

  // IVA a debito per trimestre (fatture emesse pagate)
  const debitoPerTrimestre = new Map<string, ReturnType<typeof mapFattura>[]>();
  for (const f of fatture) {
    if (!f.trimestreIVA || f.status !== "Pagata") continue;
    if (!debitoPerTrimestre.has(f.trimestreIVA)) debitoPerTrimestre.set(f.trimestreIVA, []);
    debitoPerTrimestre.get(f.trimestreIVA)!.push(f);
  }

  const today = new Date();

  const trimestri = Array.from(debitoPerTrimestre.entries()).map(([trimestre, fatt]) => {
    const ivaDebito = Math.round(fatt.reduce((s, f) => s + f.iva22, 0) * 100) / 100;
    const ivaCredito = Math.round((ivaCreditoMap.get(trimestre) ?? 0) * 100) / 100;
    const ivaNetta = Math.max(0, Math.round((ivaDebito - ivaCredito) * 100) / 100);
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const scadenzaDate = new Date(y, m - 1, d);
    const versata = scadenzaDate < today;
    const diffDays = (scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return {
      trimestre: trimestre as TrimestreIVA,
      periodo: periodoTrimestre(trimestre),
      scadenzaStr,
      scadenzaDate,
      ivaDebito,
      ivaCredito,
      ivaNetta,
      versata,
      urgent: !versata && diffDays <= 15,
      fatture: fatt,
    };
  }).sort((a, b) => a.scadenzaDate.getTime() - b.scadenzaDate.getTime());

  // Totali aggregati
  const totaleIVAVersata   = trimestri.filter((t) => t.versata).reduce((s, t) => s + t.ivaNetta, 0);
  const totaleIVADaVersare = trimestri.filter((t) => !t.versata).reduce((s, t) => s + t.ivaNetta, 0);
  const totaleCredito      = trimestri.reduce((s, t) => s + t.ivaCredito, 0);

  // Dettaglio ricevute con IVA detraibile (per la sezione credito)
  const ricevuteConIVA = ricevute.filter((f) => f.importoIVA > 0);

  return { trimestri, totaleIVAVersata, totaleIVADaVersare, totaleCredito, ricevuteConIVA };
}

export default async function ReportIVAPage() {
  const { trimestri, totaleIVAVersata, totaleIVADaVersare, totaleCredito, ricevuteConIVA } = await getData();

  return (
    <div>
      <PageHeader
        title="Report IVA"
        subtitle="Regime di cassa — liquidazione trimestrale con compensazione credito acquisti"
      />

      {/* Riepilogo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <StatCard label="IVA netta versata" value={formatEuro(totaleIVAVersata)} color="#00c864" note="storico trimestri chiusi" />
        <StatCard label="IVA credito acquisti" value={formatEuro(totaleCredito)} color="var(--sage)" note="fatture ricevute + abbonamenti" />
        <StatCard label="IVA netta da versare" value={formatEuro(totaleIVADaVersare)} color={totaleIVADaVersare > 0 ? "var(--accent)" : "var(--muted)"} note="debito − credito trimestri aperti" />
      </div>

      {/* Dettaglio per trimestre */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
        {trimestri.map((t) => (
          <div
            key={t.trimestre}
            style={{
              background: t.urgent ? "rgba(255,60,60,0.02)" : "var(--surface-2)",
              border: `1px solid ${t.urgent ? "rgba(255,60,60,0.3)" : "var(--border)"}`,
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            {/* Header trimestre */}
            <div style={{ padding: "0.9rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.9rem", color: "var(--accent)" }}>
                  {t.trimestre}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                  {t.periodo}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                  Scadenza: <span style={{ color: t.urgent ? "#ff4444" : "var(--text)" }}>{t.scadenzaStr}</span>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                  IVA debito: <span className="num" style={{ color: "var(--accent)" }}>{formatEuro(t.ivaDebito)}</span>
                </div>
                {t.ivaCredito > 0 && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
                    credito: <span className="num" style={{ color: "var(--sage)" }}>−{formatEuro(t.ivaCredito)}</span>
                  </div>
                )}
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  da versare:
                  <span className="num" style={{ color: t.ivaNetta > 0 ? "var(--text)" : "var(--sage)", fontWeight: 700, fontSize: "0.95rem" }}>
                    {formatEuro(t.ivaNetta)}
                  </span>
                </div>
                <span className={`badge ${t.versata ? "badge-success" : t.urgent ? "badge-error" : "badge-warning"}`}>
                  {t.versata ? "Versata" : "Da versare"}
                </span>
              </div>
            </div>

            {/* Fatture emesse del trimestre */}
            <div style={{ padding: "0.75rem 1.5rem", borderBottom: t.ivaCredito > 0 ? "1px solid var(--border)" : undefined }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Fattura emessa", "Importo netto", "IVA 22%", "Data incasso"].map((h) => (
                      <th key={h} style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "left", paddingBottom: "0.4rem", paddingRight: "1rem" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.fatture.map((f) => (
                    <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.4rem 1rem 0.4rem 0", fontSize: "0.82rem", fontWeight: 500 }}>{f.nome}</td>
                      <td style={{ padding: "0.4rem 1rem 0.4rem 0" }}><span className="num">{formatEuro(f.importo)}</span></td>
                      <td style={{ padding: "0.4rem 1rem 0.4rem 0" }}><span className="num" style={{ color: "var(--accent)" }}>{formatEuro(f.iva22)}</span></td>
                      <td style={{ padding: "0.4rem 0" }}><span className="num" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{f.dataIncasso ? new Date(f.dataIncasso).toLocaleDateString("it-IT") : "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ paddingTop: "0.5rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>IVA a debito</td>
                    <td colSpan={2} style={{ paddingTop: "0.5rem" }}><span className="num" style={{ color: "var(--accent)", fontWeight: 700, fontSize: "0.9rem" }}>{formatEuro(t.ivaDebito)}</span></td>
                  </tr>
                  {t.ivaCredito > 0 && (
                    <tr>
                      <td colSpan={2} style={{ paddingTop: "0.25rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>IVA a credito (acquisti)</td>
                      <td colSpan={2} style={{ paddingTop: "0.25rem" }}><span className="num" style={{ color: "var(--sage)", fontWeight: 600 }}>−{formatEuro(t.ivaCredito)}</span></td>
                    </tr>
                  )}
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td colSpan={2} style={{ paddingTop: "0.4rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", fontWeight: 700 }}>IVA netta da versare</td>
                    <td colSpan={2} style={{ paddingTop: "0.4rem" }}>
                      <span className="num" style={{ color: t.ivaNetta > 0 ? "var(--text)" : "var(--sage)", fontWeight: 700, fontSize: "1rem" }}>
                        {formatEuro(t.ivaNetta)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* IVA a credito dettaglio */}
            {t.ivaCredito > 0 && (
              <div style={{ padding: "0.6rem 1.5rem", background: "rgba(100,200,140,0.04)" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--sage)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
                  IVA a credito — {formatEuro(t.ivaCredito)} da compensare
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", lineHeight: 1.6 }}>
                  Fatture ricevute pagate nel trimestre con IVA detraibile + abbonamenti ricorrenti con IVA.
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dettaglio ricevute con IVA */}
      {ricevuteConIVA.length > 0 && (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden", marginBottom: "1rem" }}>
          <div style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--sage)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Fatture ricevute con IVA detraibile
          </div>
          <div style={{ padding: "0.75rem 1.5rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Fattura ricevuta", "Data", "Importo", "IVA detraibile"].map((h) => (
                    <th key={h} style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", letterSpacing: "0.06em", textTransform: "uppercase", textAlign: "left", paddingBottom: "0.4rem", paddingRight: "1rem" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ricevuteConIVA.map((f) => (
                  <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.4rem 1rem 0.4rem 0", fontSize: "0.82rem", fontWeight: 500 }}>{f.nome}</td>
                    <td style={{ padding: "0.4rem 1rem 0.4rem 0" }}><span className="num" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{f.dataFattura ? new Date(f.dataFattura).toLocaleDateString("it-IT") : "—"}</span></td>
                    <td style={{ padding: "0.4rem 1rem 0.4rem 0" }}><span className="num">{formatEuro(f.importo)}</span></td>
                    <td style={{ padding: "0.4rem 0" }}><span className="num" style={{ color: "var(--sage)", fontWeight: 600 }}>−{formatEuro(f.importoIVA)}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1px solid var(--border)" }}>
                  <td colSpan={3} style={{ paddingTop: "0.5rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>Totale IVA detraibile fatture</td>
                  <td style={{ paddingTop: "0.5rem" }}><span className="num" style={{ color: "var(--sage)", fontWeight: 700 }}>−{formatEuro(ricevuteConIVA.reduce((s, f) => s + f.importoIVA, 0))}</span></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <div className="stat-card">
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: "1.1rem", fontWeight: 600, color }}>
        {value}
      </div>
      {note && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem", lineHeight: 1.4 }}>
          {note}
        </div>
      )}
    </div>
  );
}

import { DB, queryAll, mapFattura, mapFatturaRicevuta } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import type { TrimestreIVA } from "@/lib/types";

export const revalidate = 0;

async function getData() {
  const [fatturePages, ricevutePages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
  ]);
  const fatture = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);

  // IVA a debito per trimestre (fatture emesse pagate)
  const debitoPerTrimestre = new Map<string, ReturnType<typeof mapFattura>[]>();
  for (const f of fatture) {
    if (!f.trimestreIVA || f.status !== "Pagata") continue;
    if (!debitoPerTrimestre.has(f.trimestreIVA)) debitoPerTrimestre.set(f.trimestreIVA, []);
    debitoPerTrimestre.get(f.trimestreIVA)!.push(f);
  }

  const today = new Date();

  const trimestri = Array.from(debitoPerTrimestre.entries()).map(([trimestre, fatt]) => {
    const ivaDebito = fatt.reduce((s, f) => s + f.iva22, 0);
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
      versata,
      urgent: !versata && diffDays <= 15,
      fatture: fatt,
    };
  }).sort((a, b) => a.scadenzaDate.getTime() - b.scadenzaDate.getTime());

  // Totali aggregati
  const totaleIVAVersata = trimestri.filter((t) => t.versata).reduce((s, t) => s + t.ivaDebito, 0);
  const totaleIVADaVersare = trimestri.filter((t) => !t.versata).reduce((s, t) => s + t.ivaDebito, 0);

  // Riepilogo fatture ricevute pagate (IVA a credito — importo lordo, da verificare con commercialista)
  const fornitoriFatturati = ricevute.filter((f) => f.status === "Pagata");
  const totaleFornitori = fornitoriFatturati.reduce((s, f) => s + f.importo, 0);

  return { trimestri, totaleIVAVersata, totaleIVADaVersare, fornitoriFatturati, totaleFornitori };
}

export default async function ReportIVAPage() {
  const { trimestri, totaleIVAVersata, totaleIVADaVersare, fornitoriFatturati, totaleFornitori } = await getData();

  return (
    <div>
      <PageHeader
        title="Report IVA"
        subtitle="Regime di cassa — liquidazione trimestrale"
      />

      {/* Riepilogo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <StatCard label="IVA versata (storico)" value={formatEuro(totaleIVAVersata)} color="#00c864" />
        <StatCard label="IVA da versare" value={formatEuro(totaleIVADaVersare)} color={totaleIVADaVersare > 0 ? "var(--accent)" : "var(--muted)"} />
        <StatCard label="Fatture fornitori pagate" value={formatEuro(totaleFornitori)} color="var(--muted)" note="IVA a credito: verifica con commercialista" />
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
                  IVA a debito: <span className="num" style={{ color: "var(--accent)", fontWeight: 600 }}>{formatEuro(t.ivaDebito)}</span>
                </div>
                <span className={`badge ${t.versata ? "badge-success" : t.urgent ? "badge-error" : "badge-warning"}`}>
                  {t.versata ? "Versata" : "Da versare"}
                </span>
              </div>
            </div>

            {/* Fatture del trimestre */}
            <div style={{ padding: "0.75rem 1.5rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Fattura", "Importo netto", "IVA 22%", "Data incasso"].map((h) => (
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
                    <td colSpan={2} style={{ paddingTop: "0.5rem", fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>Totale IVA trimestre</td>
                    <td colSpan={2} style={{ paddingTop: "0.5rem" }}><span className="num" style={{ color: "var(--accent)", fontWeight: 700, fontSize: "0.9rem" }}>{formatEuro(t.ivaDebito)}</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Nota IVA a credito */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", padding: "1rem 1.5rem" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
          IVA a credito — fatture ricevute
        </div>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)", margin: 0, lineHeight: 1.6 }}>
          Le fatture ricevute da fornitori non tracciano separatamente l&apos;IVA. Totale importo lordo fatture fornitori pagate:{" "}
          <span className="num" style={{ color: "var(--text)" }}>{formatEuro(totaleFornitori)}</span>.{" "}
          Verifica con il commercialista il calcolo dell&apos;IVA a credito detraibile.
        </p>
      </div>
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

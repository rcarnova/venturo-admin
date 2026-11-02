import { Fragment } from "react";
import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import { formatEuro, formatDate, calcolaSaldoDinamico, proiettaSaldo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import { SALDO_BASE, MUTUO, FIDO_BANCARIO } from "@/lib/config";
import { getAnticipiSoci, riepilogoSoci } from "@/lib/anticipi";
import { calcolaFlussi, fattureInForecast, type Flusso } from "@/lib/flussi";
import { calcolaCopertura, type EsitoCopertura, type ScenarioCopertura } from "@/lib/copertura";

export const revalidate = 0;

function dataEtichetta(f: Flusso): string {
  if (f.iva) return f.iva.scadenzaStr;
  if (f.scaduta) return `oggi (sc. ${f.dataOriginale.toLocaleDateString("it-IT")})`;
  const s = f.data.toLocaleDateString("it-IT");
  return f.tipo === "entrata" && f.stimata ? `${s} (+30gg)` : s;
}

async function getData() {
  const [fatturePages, ricevutePages, notePages, anticipiSoci] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.NOTE_SPESE),
    getAnticipiSoci(),
  ]);
  const fatture  = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);
  const note     = notePages.map(mapNotaSpese);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);

  const SALDO_INIZIALE = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data, anticipiSoci);

  const flussi = calcolaFlussi({ fatture, ricevute, anticipiSoci, today });

  const fattureAttese = fattureInForecast(fatture);
  const totaleAttesoAll = fattureAttese.reduce((s, f) => s + f.incassoNetto, 0);

  // Inviata senza alcuna data prevista → aggregato senza timeline
  const senzaData = flussi.filter((f) => f.senzaData);
  const fattureSenzaData = fatture.filter((f) => senzaData.some((s) => s.id === `entrata-${f.id}`));
  const totaleAtteso = senzaData.reduce((s, f) => s + f.importo, 0);

  // Rimborsi spese aperti
  const totRimborsi = note.filter((n) => n.statusRimborso === "Da rimborsare").reduce((s, n) => s + n.importo, 0);

  // Flussi nei prossimi 90 giorni — l'IVA entra comunque, la scadenza è fissa
  // e va vista anche se cade oltre la finestra: oltre90 la marca in tabella.
  const flussi90 = flussi
    .filter((f) => !f.senzaData && (f.data <= in90 || f.tipo === "iva"))
    .map((f) => {
      const dataStr = dataEtichetta(f);
      let label = f.label;
      if (f.iva) {
        const noteCredito = f.iva.override ? " · da commercialista" : f.iva.credito > 0 ? ` (−${formatEuro(f.iva.credito)} credito)` : "";
        const noteAtteso = !f.iva.override && f.iva.atteso > 0 ? ` · +${formatEuro(f.iva.atteso)} attesa` : "";
        label = `${f.label}${noteCredito}${noteAtteso}`;
      }
      return { ...f, label, dataStr, oltre90: f.data > in90 };
    });

  // Proiezioni sugli stessi flussi mostrati in timeline: le card corrispondono
  // sempre alla somma delle righe elencate sotto.
  // Tre nature diverse: vincolate (qualcuno le reclama a una data fissa),
  // discrezionali (decidiamo noi quando), previste (attese ma non confermate).
  // Vincolata = non la decidiamo noi e non dipende da ricavi futuri. Lo stato
  // "Da ricevere" riguarda il documento, non l'obbligo: l'abbonamento lo paghi.
  const usciteVincolate = flussi90.filter((f) => !f.discrezionale && !f.condizionato && f.importo < 0).reduce((s, f) => s - f.importo, 0);
  const usciteDiscrezionali = flussi90.filter((f) => f.discrezionale && f.importo < 0).reduce((s, f) => s - f.importo, 0);
  const usciteTutte = flussi90.filter((f) => f.importo < 0).reduce((s, f) => s - f.importo, 0);
  const uscitePreviste = flussi90.filter((f) => !f.certo && f.importo < 0).reduce((s, f) => s - f.importo, 0);
  const uscitePrevisteOltre90 = flussi90.filter((f) => !f.certo && f.importo < 0 && f.oltre90).reduce((s, f) => s - f.importo, 0);
  const entrateAttese = flussi90.filter((f) => f.importo > 0).reduce((s, f) => s + f.importo, 0) + totaleAtteso;

  // Il pavimento e' cio' che devi coprire comunque: gli anticipi non ci entrano.
  const saldoVincoli = proiettaSaldo(SALDO_INIZIALE, 0, usciteVincolate).conservativo;
  const saldoOttimistico = proiettaSaldo(SALDO_INIZIALE, entrateAttese, usciteTutte).ottimistico;

  // Quando tocca il punto più basso, considerando le sole uscite certe:
  // sapere se il minimo cade fra una settimana o a dicembre cambia la reazione.
  let running = SALDO_INIZIALE;
  let minimo = SALDO_INIZIALE;
  let dataMinimo: Date | null = null;
  for (const f of flussi90.filter((x) => x.certo && !x.discrezionale)) {
    running += f.importo;
    if (running < minimo) { minimo = running; dataMinimo = f.data; }
  }
  const dataMinimoStr = dataMinimo ? dataMinimo.toLocaleDateString("it-IT") : null;

  const copertura = calcolaCopertura(SALDO_INIZIALE, flussi, FIDO_BANCARIO);

  return { copertura, soci: riepilogoSoci(anticipiSoci), flussi90, flussiTutti: flussi, fattureAttese: fattureSenzaData, totaleAttesoAll, totaleAtteso, totRimborsi, saldoVincoli, saldoOttimistico, saldoAttuale: SALDO_INIZIALE, dataMinimoStr, usciteVincolate, usciteDiscrezionali, uscitePreviste, uscitePrevisteOltre90, nFattureInviate: fattureAttese.filter(f => f.status === "Inviata").length };
}

export default async function CassaPage() {
  const { copertura, soci, flussi90, fattureAttese, totaleAtteso, totaleAttesoAll, totRimborsi, saldoVincoli, saldoOttimistico, saldoAttuale, dataMinimoStr, usciteVincolate, usciteDiscrezionali, uscitePreviste, uscitePrevisteOltre90, nFattureInviate } = await getData();

  const liquiditaTotale = saldoAttuale + FIDO_BANCARIO;
  // Il fido va confrontato col caso base, non col migliore: e' da quello che ti devi proteggere.
  const sfondaFidoSempre = (saldoOttimistico + FIDO_BANCARIO) < 0;
  const sfondaFidoCasoBase = (saldoVincoli + FIDO_BANCARIO) < 0;

  // Proiezione a step
  let runningBalance = saldoAttuale;
  const steps = flussi90.map((f) => {
    runningBalance += f.importo;
    return { ...f, saldo: runningBalance };
  });

  return (
    <div>
      <PageHeader
        title="Cassa"
        subtitle="Prossimi 90 giorni, più le scadenze IVA anche se successive"
      />
      <TabNav tabs={[
        { href: "/cassa", label: "Proiezione flussi", active: true },
        { href: "/scadenziario", label: "Calendario eventi", active: false },
      ]} />

      {/* Cards di sintesi */}
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <SaldoCard label="Saldo attuale" value={formatEuro(saldoAttuale)} color="var(--text)" tier="reale" />
        <SaldoCard label="Fido bancario" value={formatEuro(FIDO_BANCARIO)} color="var(--muted)" note="linea di credito disponibile" tier="reale" />
        <SaldoCard label="Liquidità totale" value={formatEuro(liquiditaTotale)} color="var(--accent)" note="saldo + fido" tier="reale" />
        <SaldoCard label="Entrate attese" value={formatEuro(totaleAttesoAll)} color="#00c864" note={nFattureInviate > 0 ? `${nFattureInviate} inviate + bozze con data` : "tutte bozze con data"} tier="impegno" />
        <SaldoCard label="Uscite vincolate" value={formatEuro(usciteVincolate)} color="#ffb400" note="IVA, fornitori, mutuo, ritenute" tier="impegno" />
        <SaldoCard label="Anticipi soci" value={formatEuro(usciteDiscrezionali)} color="var(--accent)" note="rinviabili in base alla cassa" tier="scenario" />
        <SaldoCard label="Uscite previste" value={formatEuro(uscitePreviste)} color="var(--muted)" note={uscitePrevisteOltre90 > 0 ? `non confermate · ${formatEuro(uscitePrevisteOltre90)} oltre i 90gg` : "non confermate"} tier="scenario" />
        <SaldoCard
          label="Coprendo i soli vincoli"
          value={formatEuro(saldoVincoli)}
          color={(saldoVincoli + FIDO_BANCARIO) < 0 ? "#ff4444" : (saldoVincoli + FIDO_BANCARIO) < 2000 ? "#ffb400" : "var(--text)"}
          note={`con fido: ${formatEuro(saldoVincoli + FIDO_BANCARIO)}${dataMinimoStr ? ` · minimo il ${dataMinimoStr}` : ""}`}
          tier="impegno"
        />
        <SaldoCard
          label="Scenario ottimistico"
          value={`~${formatEuro(saldoOttimistico)}`}
          color="var(--accent)"
          note="se incassi tutto"
          tier="scenario"
        />
        <SaldoCard
          label="Mutuo residuo"
          value={formatEuro(MUTUO.totaleRimanente)}
          color="var(--muted)"
          note={`${MUTUO.nRateRimanenti} rate · €${MUTUO.importoRata.toFixed(2)}/mese`}
        />
        {totRimborsi > 0 && (
          <SaldoCard label="Rimborsi aperti" value={formatEuro(totRimborsi)} color="#ffb400" note="non inclusi nelle uscite" tier="impegno" />
        )}
      </div>
      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: "0.55rem", color: "var(--muted-2)", marginBottom: "1.5rem" }}>
        <span><span style={{ color: "#00c864" }}>●</span> Reale — dati certi</span>
        <span><span style={{ color: "var(--accent)" }}>●</span> Impegni — obbligazioni contratte</span>
        <span><span style={{ color: "#ffb400" }}>●</span> Scenario — simulazione</span>
      </div>

      {(sfondaFidoSempre || sfondaFidoCasoBase) && (
        <div style={{ background: sfondaFidoSempre ? "rgba(255,60,60,0.08)" : "rgba(255,180,0,0.08)", border: `1px solid ${sfondaFidoSempre ? "rgba(255,60,60,0.3)" : "rgba(255,180,0,0.35)"}`, borderRadius: "6px", padding: "0.75rem 1.25rem", marginBottom: "1.5rem", fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: sfondaFidoSempre ? "#ff4444" : "#ffb400" }}>
          {sfondaFidoSempre
            ? `⚠ Il fido non basta nemmeno incassando tutto: mancano ${formatEuro(Math.abs(saldoOttimistico + FIDO_BANCARIO))}.`
            : `⚠ Anche rinviando gli anticipi soci, il fido non basta a coprire gli impegni vincolati${dataMinimoStr ? ` dal ${dataMinimoStr}` : ""}: mancano ${formatEuro(Math.abs(saldoVincoli + FIDO_BANCARIO))}.`}
        </div>
      )}

      {/* Copertura anticipi */}
      {copertura.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Copertura anticipi — saldo fino al primo versamento IVA successivo
          </div>
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr><th>Data</th><th>Soci</th><th>Totale</th><th>Previsto, con le bozze</th><th>Prudente, solo fatture emesse</th></tr>
                </thead>
                <tbody>
                  {copertura.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: c.inRitardo ? "#ff4444" : "var(--muted)" }}>{formatDate(c.data)}{c.inRitardo ? " ⚠ in ritardo" : ""}</td>
                      <td style={{ fontSize: "0.82rem", fontWeight: 500 }}>{c.soci.map((s) => `${s.socio} ${formatEuro(s.importo)}`).join(" · ")}</td>
                      <td><span className="num">{formatEuro(c.importo)}</span></td>
                      <td><EsitoCella s={c.previsto} /></td>
                      <td><EsitoCella s={c.prudente} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {soci.length > 0 && (
            <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", marginTop: "0.5rem" }}>
              {soci.map((s) => (
                <span key={s.socio}>{s.socio}: pagati {formatEuro(s.pagato)} · pianificati {formatEuro(s.pianificato)}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fatture attese */}
      {fattureAttese.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Entrate attese — senza data di invio (non in timeline)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {fattureAttese.map((f) => (
              <span key={f.id} style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", background: "rgba(0,200,100,0.06)", border: "1px solid rgba(0,200,100,0.2)", borderRadius: "3px", padding: "0.25rem 0.6rem", color: "var(--text)" }}>
                {f.nome} <span style={{ color: "#00c864" }}>+{formatEuro(f.incassoNetto)}</span>
                <span style={{ color: "var(--muted-2)", marginLeft: "0.3rem" }}>({formatEuro(f.importo)} imponibile)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timeline flussi */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Proiezione flussi
        </div>
        <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        <div style={{ display: "flex", gap: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.52rem", color: "var(--muted-2)" }}>
          <span style={{ borderLeft: "2px solid rgba(0,200,100,0.5)", paddingLeft: "0.35rem" }}>incasso stimato</span>
          <span style={{ borderLeft: "2px solid rgba(255,60,60,0.45)", paddingLeft: "0.35rem" }}>uscita certa</span>
          <span style={{ borderLeft: "2px solid rgba(255,180,0,0.45)", paddingLeft: "0.35rem" }}>uscita prevista</span>
          <span style={{ borderLeft: "2px solid var(--accent)", paddingLeft: "0.35rem" }}>discrezionale</span>
        </div>
      </div>

      {steps.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--muted)", padding: "1rem 0" }}>
          Nessuna uscita prevista nei prossimi 90 giorni.
        </div>
      ) : (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
          <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrizione</th>
                <th className="col-hide-mobile">Tipo</th>
                <th>Importo</th>
                <th>Saldo proiettato</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>Oggi</td>
                <td style={{ fontSize: "0.82rem", fontWeight: 500 }}>Saldo iniziale</td>
                <td className="col-hide-mobile"></td>
                <td></td>
                <td><span className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{formatEuro(saldoAttuale)}</span></td>
              </tr>
              {steps.map((s, i) => {
                const primaOltre90 = s.oltre90 && !steps[i - 1]?.oltre90;
                const bordo = s.importo > 0
                  ? "inset 2px 0 0 rgba(0,200,100,0.35)"
                  : s.discrezionale
                  ? "inset 2px 0 0 var(--accent)"
                  : s.certo
                  ? "inset 2px 0 0 rgba(255,60,60,0.45)"
                  : "inset 2px 0 0 rgba(255,180,0,0.45)";
                return (
                <Fragment key={s.id}>
                {primaOltre90 && (
                  <tr>
                    <td colSpan={5} style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", letterSpacing: "0.06em", textTransform: "uppercase", background: "var(--surface-3)", padding: "0.4rem 0.75rem", borderTop: "1px solid var(--border)" }}>
                      ↓ oltre i 90 giorni — scadenze IVA, mostrate perché la data è fissa
                    </td>
                  </tr>
                )}
                <tr style={{
                  ...(s.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } : s.importo > 0 ? { background: "rgba(0,200,100,0.025)" } : {}),
                  boxShadow: bordo,
                  ...(s.oltre90 ? { opacity: 0.62 } : {}),
                }}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>{s.dataStr}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 500 }}>{s.label}</td>
                  <td className="col-hide-mobile">
                    <span className={`badge ${s.tipo === "entrata" ? "badge-success" : s.tipo === "iva" ? "badge-error" : s.tipo === "ritenuta" ? "badge-error" : s.tipo === "mutuo" ? "badge-neutral" : s.tipo === "anticipo_soci" ? "badge-accent" : s.tipo === "abbonamento" ? "badge-neutral" : "badge-warning"}`} style={{ fontSize: "0.58rem" }}>
                      {s.tipo === "entrata" ? "~Incasso atteso" : s.tipo === "iva" ? (s.certo ? "IVA" : "~IVA stimata") : s.tipo === "ritenuta" ? "Ritenuta" : s.tipo === "mutuo" ? "Mutuo" : s.tipo === "anticipo_soci" ? "Anticipo" : s.tipo === "abbonamento" ? "Ricorrente" : "Fattura"}
                    </span>
                  </td>
                  <td>
                    <span className="num" style={{ color: s.importo > 0 ? "#00c864" : "#ff4444" }}>
                      {s.importo > 0 ? "~+" : "−"}{formatEuro(Math.abs(s.importo))}
                    </span>
                  </td>
                  <td>
                    <span className="num" style={{ color: s.saldo < 0 ? "#ff4444" : s.saldo < 2000 ? "#ffb400" : "var(--text)", fontWeight: 600 }}>
                      {formatEuro(s.saldo)}
                    </span>
                  </td>
                </tr>
                </Fragment>
              );})}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

const ESITO: Record<EsitoCopertura, { label: string; color: string }> = {
  coperto: { label: "Coperto", color: "#00c864" },
  solo_fido: { label: "Solo col fido", color: "#ffb400" },
  non_coperto: { label: "Non coperto", color: "#ff4444" },
};

function EsitoCella({ s }: { s: ScenarioCopertura }) {
  const e = ESITO[s.esito];
  return (
    <div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: e.color, fontWeight: 600 }}>{e.label}</span>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "2px" }}>
        minimo {formatEuro(s.saldoMinimo)} il {formatDate(s.dataMinimo)}
        {s.esito !== "coperto" ? ` · pagabili senza fido ${formatEuro(s.massimoSenzaFido)}` : ""}
      </div>
    </div>
  );
}

function SaldoCard({ label, value, color, note, tier }: { label: string; value: string; color: string; note?: string; tier?: "reale" | "impegno" | "scenario" }) {
  const tierBorder: Record<string, string> = { reale: "#00c864", impegno: "var(--accent)", scenario: "#ffb400" };
  const borderLeft = tier ? `2px solid ${tierBorder[tier]}` : undefined;
  return (
    <div className="stat-card" style={borderLeft ? { borderLeft } : {}}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: "1.1rem", fontWeight: 600, color }}>
        {value}
      </div>
      {note && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
          {note}
        </div>
      )}
    </div>
  );
}

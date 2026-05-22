import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapDeal } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

const ANNO = 2026;
const SALDO_INIZIALE = 10_000;

const MUTUO = {
  importoRata: 136.79,
  prossimaRata: new Date(2026, 5, 21),
  nRateRimanenti: 27,
};

const ANTICIPO_SOCI = 3_000; // €/mese, giorno 28

const MESI_SHORT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
const MESI_FULL  = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

type Uscita = {
  data: Date;
  mese: number;
  label: string;
  importo: number;
  tipo: "iva" | "mutuo" | "fornitore" | "anticipo_soci";
};

async function getData() {
  const [fatturePages, ricevutePages, pipelinePages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.PIPELINE),
  ]);

  const fatture    = fatturePages.map(mapFattura);
  const ricevute   = ricevutePages.map(mapFatturaRicevuta);
  const deals      = pipelinePages.map(mapDeal);

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const fineAnno = new Date(ANNO, 11, 31, 23, 59, 59);
  const meseCorrente = today.getMonth(); // 0-indexed

  const semestre  = meseCorrente < 6 ? 1 : 2;
  const fattore   = semestre === 1 ? 1.0 : 0.5;

  // ── Entrate ────────────────────────────────────────────────────────────
  const incassatoYTD = fatture
    .filter(f => f.status === "Pagata" && f.dataIncasso?.startsWith(`${ANNO}`))
    .reduce((s, f) => s + f.importo, 0);

  const incassatoPerMese = Array(12).fill(0) as number[];
  for (const f of fatture) {
    if (f.status === "Pagata" && f.dataIncasso?.startsWith(`${ANNO}`)) {
      const m = parseInt(f.dataIncasso.slice(5, 7)) - 1;
      incassatoPerMese[m] += f.importo;
    }
  }

  const daIncassare = fatture
    .filter(f => f.status === "Inviata")
    .reduce((s, f) => s + f.importo, 0);

  // Won deals: residuo da fatturare × fattore semestre
  const fatturePerProgetto = new Map<string, number>();
  for (const f of fatture) {
    if (f.progetto) fatturePerProgetto.set(f.progetto, (fatturePerProgetto.get(f.progetto) ?? 0) + f.importo);
  }
  const wonDeals = deals.filter(d => d.status === "Won");
  const totaleVenduto = wonDeals.reduce((s, d) => s + d.valore, 0);
  const daFatturareWon = wonDeals.reduce((s, d) => {
    const fatturato = d.progettoId ? (fatturePerProgetto.get(d.progettoId) ?? 0) : 0;
    return s + Math.max(0, d.valore - fatturato) * fattore;
  }, 0);

  const totaleEntrateAttese = daIncassare + daFatturareWon;

  // ── Uscite fino a fine anno ────────────────────────────────────────────
  const uscite: Uscita[] = [];

  // IVA
  const ivaPerTrimestre = new Map<string, number>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre.set(f.trimestreIVA, (ivaPerTrimestre.get(f.trimestreIVA) ?? 0) + f.iva22);
    }
  }
  for (const [trimestre, totaleIVA] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const scadenzaDate = new Date(y, m - 1, d); scadenzaDate.setHours(0, 0, 0, 0);
    if (scadenzaDate < today || scadenzaDate > fineAnno) continue;
    uscite.push({ data: scadenzaDate, mese: scadenzaDate.getMonth(), label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}`, importo: totaleIVA, tipo: "iva" });
  }

  // Mutuo
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata); d.setMonth(d.getMonth() + i); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d, mese: d.getMonth(), label: "Rata mutuo", importo: MUTUO.importoRata, tipo: "mutuo" });
  }

  // Anticipo soci — €3.000 il 28 di ogni mese
  for (let m = today.getMonth(); m <= 11; m++) {
    const d = new Date(ANNO, m, 28); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d, mese: m, label: "Anticipo soci", importo: ANTICIPO_SOCI, tipo: "anticipo_soci" });
  }

  // Fornitori
  for (const f of ricevute) {
    if (f.status !== "Ricevuta" || !f.scadenza) continue;
    const d = new Date(f.scadenza); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d, mese: d.getMonth(), label: f.nome, importo: f.importo, tipo: "fornitore" });
  }

  uscite.sort((a, b) => a.data.getTime() - b.data.getTime());

  // Per mese: somma uscite
  const uscitePerMese = Array(12).fill(0) as number[];
  for (const u of uscite) uscitePerMese[u.mese] += u.importo;

  const totaleIVA2026       = uscite.filter(u => u.tipo === "iva").reduce((s, u) => s + u.importo, 0);
  const totaleMutuo2026     = uscite.filter(u => u.tipo === "mutuo").reduce((s, u) => s + u.importo, 0);
  const totaleFornitore2026 = uscite.filter(u => u.tipo === "fornitore").reduce((s, u) => s + u.importo, 0);
  const totaleAnticipo2026  = uscite.filter(u => u.tipo === "anticipo_soci").reduce((s, u) => s + u.importo, 0);
  const totaleUscite        = uscite.reduce((s, u) => s + u.importo, 0);

  const saldoConservativo  = SALDO_INIZIALE - totaleUscite;
  const saldoOttimistico   = SALDO_INIZIALE + totaleEntrateAttese - totaleUscite;

  // Running balance mensile (da mese corrente a dicembre, solo uscite)
  // saldo parte da SALDO_INIZIALE oggi
  const righe: { mese: number; uscite: number; saldo: number; passato: boolean; usciteDettaglio: Uscita[] }[] = [];
  let running = SALDO_INIZIALE;
  for (let m = meseCorrente; m <= 11; m++) {
    const usciteMese = uscitePerMese[m];
    running -= usciteMese;
    righe.push({
      mese: m,
      uscite: usciteMese,
      saldo: running,
      passato: false,
      usciteDettaglio: uscite.filter(u => u.mese === m),
    });
  }

  return {
    semestre, fattore,
    incassatoYTD, incassatoPerMese, meseCorrente,
    daIncassare, daFatturareWon, totaleVenduto,
    totaleEntrateAttese,
    uscite,
    totaleIVA2026, totaleMutuo2026, totaleFornitore2026, totaleAnticipo2026, totaleUscite,
    saldoConservativo, saldoOttimistico,
    righe,
    nWon: wonDeals.length,
  };
}

export default async function PrevisioneAnnualePage() {
  const {
    semestre, fattore,
    incassatoYTD, meseCorrente,
    daIncassare, daFatturareWon, totaleVenduto,
    totaleEntrateAttese,
    uscite,
    totaleIVA2026, totaleMutuo2026, totaleFornitore2026, totaleAnticipo2026, totaleUscite,
    saldoConservativo, saldoOttimistico,
    righe,
    nWon,
  } = await getData();

  return (
    <div>
      <PageHeader
        title={`Previsione ${ANNO}`}
        subtitle={`${MESI_FULL[meseCorrente]} → Dicembre ${ANNO} · saldo attuale €10.000`}
      />

      {/* Semestre badge */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.75rem" }}>
        <span className={`badge ${semestre === 1 ? "badge-accent" : "badge-warning"}`}>
          {semestre === 1 ? "1° Semestre" : "2° Semestre"}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>
          Venduto {nWon} deal Won · conteggiato al {Math.round(fattore * 100)}%
          {semestre === 2 ? " — delivery potenzialmente nel 2027" : " — consegna attesa entro fine anno"}
        </span>
      </div>

      {/* Entrate / Uscite stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.75rem" }}>
        {/* Entrate */}
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Entrate
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <RigaValore label="Incassato YTD" value={formatEuro(incassatoYTD)} color="var(--sage)" note="fatture già incassate nel 2026" />
            <RigaValore label="Da incassare" value={formatEuro(daIncassare)} color="var(--accent)" note="fatture inviate, non ancora pagate" />
            <RigaValore
              label={`Venduto da fatturare ×${Math.round(fattore * 100)}%`}
              value={formatEuro(Math.round(daFatturareWon))}
              color={semestre === 1 ? "var(--text)" : "#ffb400"}
              note={`su ${formatEuro(totaleVenduto)} totale Won`}
            />
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <RigaValore label="Totale entrate attese" value={formatEuro(Math.round(totaleEntrateAttese))} color="var(--text)" bold />
            </div>
          </div>
        </div>

        {/* Uscite */}
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Uscite pianificate
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <RigaValore label="Anticipo soci" value={formatEuro(totaleAnticipo2026)} color="var(--accent)" note={`€3.000/mese × ${Math.round(totaleAnticipo2026 / 3000)} mesi`} />
            <RigaValore label="IVA (Q2 + Q3)" value={formatEuro(totaleIVA2026)} color="#ff4444" note="versamenti trimestrali" />
            <RigaValore label="Mutuo" value={formatEuro(Math.round(totaleMutuo2026 * 100) / 100)} color="var(--muted)" note="rate fino a dicembre" />
            <RigaValore label="Fornitori da pagare" value={formatEuro(totaleFornitore2026)} color="#ffb400" note="fatture ricevute con scadenza" />
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <RigaValore label="Totale uscite" value={formatEuro(Math.round(totaleUscite * 100) / 100)} color="var(--text)" bold />
            </div>
          </div>
        </div>
      </div>

      {/* Saldo proiettato fine anno */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <div className="stat-card" style={{ borderColor: "var(--border-hover)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Saldo conservativo
          </div>
          <div className="num" style={{ fontSize: "1.3rem", fontWeight: 700, color: saldoConservativo < 0 ? "#ff4444" : saldoConservativo < 3000 ? "#ffb400" : "var(--text)" }}>
            {formatEuro(Math.round(saldoConservativo))}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
            saldo attuale − uscite (nessuna entrata)
          </div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--accent-border)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Saldo ottimistico
          </div>
          <div className="num" style={{ fontSize: "1.3rem", fontWeight: 700, color: saldoOttimistico < 0 ? "#ff4444" : "var(--sage)" }}>
            {formatEuro(Math.round(saldoOttimistico))}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
            + entrate attese ({formatEuro(Math.round(totaleEntrateAttese))})
          </div>
        </div>
      </div>

      {/* Timeline mensile */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Proiezione mensile — solo uscite certe
      </div>
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden", marginBottom: "2rem" }}>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Mese</th>
                <th className="col-hide-mobile">Uscite dettaglio</th>
                <th>Totale uscite</th>
                <th>Saldo fine mese</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>Oggi</td>
                <td className="col-hide-mobile"></td>
                <td></td>
                <td><span className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{formatEuro(SALDO_INIZIALE)}</span></td>
              </tr>
              {righe.map((r) => (
                <tr key={r.mese} style={r.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } : {}}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" }}>
                    {MESI_FULL[r.mese]}
                  </td>
                  <td className="col-hide-mobile">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {r.usciteDettaglio.map((u, i) => (
                        <span key={i} className={`badge ${u.tipo === "iva" ? "badge-error" : u.tipo === "mutuo" ? "badge-neutral" : u.tipo === "anticipo_soci" ? "badge-accent" : "badge-warning"}`} style={{ fontSize: "0.55rem" }}>
                          {u.tipo === "iva" ? u.label.split("—")[0].trim() : u.tipo === "mutuo" ? "Mutuo" : u.tipo === "anticipo_soci" ? "Anticipo" : u.label} {formatEuro(u.importo)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {r.uscite > 0
                      ? <span className="num" style={{ color: "#ff4444" }}>−{formatEuro(Math.round(r.uscite * 100) / 100)}</span>
                      : <span style={{ color: "var(--muted-2)", fontSize: "0.7rem" }}>—</span>
                    }
                  </td>
                  <td>
                    <span className="num" style={{ color: r.saldo < 0 ? "#ff4444" : r.saldo < 2000 ? "#ffb400" : "var(--text)", fontWeight: 600 }}>
                      {formatEuro(Math.round(r.saldo))}
                    </span>
                  </td>
                </tr>
              ))}
              {/* Riga ottimistica finale */}
              <tr style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--sage)" }}>Dic (ottimistico)</td>
                <td className="col-hide-mobile" style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>
                  + entrate attese {formatEuro(Math.round(totaleEntrateAttese))}
                </td>
                <td></td>
                <td><span className="num" style={{ color: saldoOttimistico >= 0 ? "var(--sage)" : "#ff4444", fontWeight: 700 }}>{formatEuro(Math.round(saldoOttimistico))}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Scadenze chiave */}
      {uscite.length > 0 && (
        <>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Scadenze e uscite pianificate
          </div>
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrizione</th>
                    <th>Tipo</th>
                    <th>Importo</th>
                  </tr>
                </thead>
                <tbody>
                  {uscite.map((u, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {u.data.toLocaleDateString("it-IT")}
                      </td>
                      <td style={{ fontWeight: 500, fontSize: "0.82rem" }}>{u.label}</td>
                      <td>
                        <span className={`badge ${u.tipo === "iva" ? "badge-error" : u.tipo === "mutuo" ? "badge-neutral" : u.tipo === "anticipo_soci" ? "badge-accent" : "badge-warning"}`} style={{ fontSize: "0.58rem" }}>
                          {u.tipo === "iva" ? "IVA" : u.tipo === "mutuo" ? "Mutuo" : u.tipo === "anticipo_soci" ? "Anticipo" : "Fornitore"}
                        </span>
                      </td>
                      <td><span className="num" style={{ color: "#ff4444" }}>−{formatEuro(u.importo)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RigaValore({ label, value, color, note, bold }: { label: string; value: string; color: string; note?: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", fontWeight: bold ? 600 : 400 }}>{label}</div>
        {note && <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", color: "var(--muted-2)" }}>{note}</div>}
      </div>
      <div className="num" style={{ fontWeight: bold ? 700 : 600, color, whiteSpace: "nowrap", fontSize: bold ? "0.95rem" : "0.82rem" }}>
        {value}
      </div>
    </div>
  );
}

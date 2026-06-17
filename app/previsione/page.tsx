import { DB, queryAll, mapFattura, mapFatturaRicevuta } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, scadenzaRitenuta, calcolaIVACreditoPerTrimestre, calcolaTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import { SALDO_BASE, MUTUO, COSTI_RICORRENTI, FIDO_BANCARIO } from "@/lib/config";
import { getAnticipiSoci } from "@/lib/anticipi";

export const revalidate = 0;

const ANNO = new Date().getFullYear();

const MESI_FULL  = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const MESI_SHORT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

type Uscita = {
  data: Date;
  mese: number;
  label: string;
  importo: number;
  tipo: "iva" | "mutuo" | "fornitore" | "anticipo_soci" | "ritenuta" | "abbonamento";
};

async function getData() {
  const [fatturePages, ricevutePages, anticipiSoci] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    getAnticipiSoci(),
  ]);

  const fatture  = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const fineAnno = new Date(ANNO, 11, 31, 23, 59, 59);
  const meseCorrente = today.getMonth(); // 0-indexed
  const oggiStr = today.toISOString().split("T")[0]; // "YYYY-MM-DD"

  const SALDO_INIZIALE = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data);

  // ── Entrate ────────────────────────────────────────────────────────────
  // solo incassi effettivamente avvenuti (dataIncasso <= oggi)
  const incassatoYTD = fatture
    .filter(f => f.status === "Pagata" && f.dataIncasso && f.dataIncasso.startsWith(`${ANNO}`) && f.dataIncasso <= oggiStr)
    .reduce((s, f) => s + f.incassoNetto, 0);

  const incassatoPerMese = Array(12).fill(0) as number[];
  for (const f of fatture) {
    if (f.status === "Pagata" && f.dataIncasso && f.dataIncasso.startsWith(`${ANNO}`) && f.dataIncasso <= oggiStr) {
      const m = parseInt(f.dataIncasso.slice(5, 7)) - 1;
      incassatoPerMese[m] += f.incassoNetto;
    }
  }

  // Previsione: include "Inviata" + "Da inviare" con dataIncassoAtteso (simulazione flussi)
  const fattureInForecast = fatture.filter(f =>
    f.status === "Inviata" ||
    (f.status === "Da inviare" && f.dataIncassoAtteso != null)
  );

  // ── Uscite fino a fine anno ────────────────────────────────────────────
  const uscite: Uscita[] = [];

  // IVA — debito da fatture Pagata (certo) + IVA attesa da fattureInForecast (simulazione)
  const ivaPerTrimestre = new Map<string, { certo: number; atteso: number }>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      const prev = ivaPerTrimestre.get(f.trimestreIVA) ?? { certo: 0, atteso: 0 };
      ivaPerTrimestre.set(f.trimestreIVA, { ...prev, certo: prev.certo + f.iva22 });
    }
  }
  // IVA attesa: usa la stessa data prevista di incasso per determinare il trimestre
  for (const f of fattureInForecast) {
    let d: Date;
    if (f.dataIncassoAtteso) {
      d = new Date(f.dataIncassoAtteso + "T00:00:00");
    } else {
      d = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(today);
      d.setDate(d.getDate() + 30);
    }
    if (d < today) d = new Date(today);
    const trim = calcolaTrimestre(d.toISOString().split("T")[0]);
    if (!trim) continue;
    const prev = ivaPerTrimestre.get(trim) ?? { certo: 0, atteso: 0 };
    ivaPerTrimestre.set(trim, { ...prev, atteso: prev.atteso + f.iva22 });
  }
  const ivaCredito = calcolaIVACreditoPerTrimestre(ricevute, COSTI_RICORRENTI, ANNO);
  for (const [trimestre, { certo: ivaDebCerto, atteso: ivaDebAtteso }] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const scadenzaDate = new Date(y, m - 1, d); scadenzaDate.setHours(0, 0, 0, 0);
    if (scadenzaDate < today || scadenzaDate > fineAnno) continue;
    const creditoTrimestre = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
    const ivaNetta = Math.max(0, Math.round((ivaDebCerto + ivaDebAtteso - creditoTrimestre) * 100) / 100);
    const noteCredito = creditoTrimestre > 0 ? ` (−${formatEuro(creditoTrimestre)} credito)` : "";
    const noteAtteso = ivaDebAtteso > 0 ? ` · +${formatEuro(Math.round(ivaDebAtteso))} da incassi previsti` : "";
    uscite.push({ data: scadenzaDate, mese: scadenzaDate.getMonth(), label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}${noteCredito}${noteAtteso}`, importo: ivaNetta, tipo: "iva" });
  }

  // Mutuo
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata); d.setMonth(d.getMonth() + i); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d, mese: d.getMonth(), label: "Rata mutuo", importo: MUTUO.importoRata, tipo: "mutuo" });
  }

  // Anticipo soci — rate pianificate (da Notion se configurato, altrimenti config.ts)
  for (const a of anticipiSoci) {
    const d = new Date(a.data); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d, mese: d.getMonth(), label: "Anticipo soci", importo: a.importo, tipo: "anticipo_soci" });
  }

  // Fornitori — include fatture da pagare (Ricevuta) e scadute (In ritardo)
  for (const f of ricevute) {
    if ((f.status !== "Ricevuta" && f.status !== "In ritardo") || !f.scadenza) continue;
    const d = new Date(f.scadenza); d.setHours(0, 0, 0, 0);
    if (d > fineAnno) continue;
    const scaduta = d < today;
    const dataEffettiva = scaduta ? today : d;
    uscite.push({ data: dataEffettiva, mese: dataEffettiva.getMonth(), label: scaduta ? `${f.nome} ⚠ scaduta` : f.nome, importo: f.importo, tipo: "fornitore" });
  }

  // Costi ricorrenti (mensili e non)
  for (const costo of COSTI_RICORRENTI) {
    const importoLordo = Math.round(costo.importoNetto * (1 + costo.aliquotaIVA) * 100) / 100;
    const freq = costo.frequenzaMesi ?? 1;
    for (let m = 0; m <= 11; m++) {
      if (freq > 1 && costo.primaData) {
        const diff = (ANNO - costo.primaData.anno) * 12 + (m - costo.primaData.mese);
        if (diff < 0 || diff % freq !== 0) continue;
      }
      const lastDay = new Date(ANNO, m + 1, 0).getDate();
      const d = new Date(ANNO, m, Math.min(costo.giornoAddebito, lastDay)); d.setHours(0, 0, 0, 0);
      if (d < today || d > fineAnno) continue;
      uscite.push({ data: d, mese: m, label: costo.label, importo: importoLordo, tipo: "abbonamento" });
    }
  }

  // Ritenute d'acconto — 15 del mese successivo al pagamento fornitore (usa importoRitenuta da SDI/Notion)
  for (const f of ricevute) {
    if (!f.importoRitenuta) continue;
    const dataBase = f.dataPagamento ? new Date(f.dataPagamento)
      : f.scadenza ? (new Date(f.scadenza) < today ? new Date(today) : new Date(f.scadenza))
      : null;
    if (!dataBase) continue;
    const scad = scadenzaRitenuta(dataBase);
    if (scad < today || scad > fineAnno) continue;
    uscite.push({ data: scad, mese: scad.getMonth(), label: `Ritenuta ${f.nome}`, importo: f.importoRitenuta, tipo: "ritenuta" });
  }

  uscite.sort((a, b) => a.data.getTime() - b.data.getTime());

  // Per mese: somma uscite
  const uscitePerMese = Array(12).fill(0) as number[];
  for (const u of uscite) uscitePerMese[u.mese] += u.importo;

  // Per mese: entrate attese da fatture Inviata
  // Priorità: dataIncassoAtteso (Notion) > dataInvio+30gg > oggi+30gg
  const entrateAttesaPerMese = Array(12).fill(0) as number[];
  const entrateDettaglioPerMese: { nome: string; importo: number }[][] = Array.from({ length: 12 }, () => []);
  for (const f of fattureInForecast) {
    let d: Date;
    if (f.dataIncassoAtteso) {
      d = new Date(f.dataIncassoAtteso + "T00:00:00");
    } else {
      // Solo "Inviata" senza dataIncassoAtteso: stima +30gg da dataInvio o da oggi
      d = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(today);
      d.setDate(d.getDate() + 30);
    }
    if (d < today) d = new Date(today);
    if (d.getFullYear() !== ANNO) continue;
    const m = d.getMonth();
    entrateAttesaPerMese[m] += f.incassoNetto;
    entrateDettaglioPerMese[m].push({
      nome: f.status === "Da inviare" ? `⚑ ${f.nome}` : f.nome,
      importo: f.incassoNetto,
    });
  }

  // daIncassare derivato dalla timeline mensile → coerente con la somma delle righe
  const daIncassare = entrateAttesaPerMese.reduce((s, v) => s + v, 0);
  const daIncassareFuoriAnno = Math.round(
    (fattureInForecast.reduce((s, f) => s + f.incassoNetto, 0) - daIncassare) * 100
  ) / 100;
  const totaleEntrateAttese = daIncassare;

  const noteAnticipo = uscite.filter(u => u.tipo === "anticipo_soci").map(u => `${MESI_SHORT[u.mese]} ${formatEuro(u.importo)}`).join(" · ") || "nessuno";

  const totaleIVA2026         = uscite.filter(u => u.tipo === "iva").reduce((s, u) => s + u.importo, 0);
  const totaleMutuo2026       = uscite.filter(u => u.tipo === "mutuo").reduce((s, u) => s + u.importo, 0);
  const totaleFornitore2026   = uscite.filter(u => u.tipo === "fornitore").reduce((s, u) => s + u.importo, 0);
  const totaleAnticipo2026    = uscite.filter(u => u.tipo === "anticipo_soci").reduce((s, u) => s + u.importo, 0);
  const totaleRitenuta2026    = uscite.filter(u => u.tipo === "ritenuta").reduce((s, u) => s + u.importo, 0);
  const totaleAbbonamenti2026 = uscite.filter(u => u.tipo === "abbonamento").reduce((s, u) => s + u.importo, 0);
  const totaleUscite          = uscite.reduce((s, u) => s + u.importo, 0);

  // Riepilogo per semestre
  const incassatoH1 = incassatoPerMese.slice(0, 6).reduce((s, v) => s + v, 0);
  const incassatoH2 = incassatoPerMese.slice(6).reduce((s, v) => s + v, 0);
  const entrateAttesaH1 = entrateAttesaPerMese.slice(0, 6).reduce((s, v) => s + v, 0);
  const entrateAttesaH2 = entrateAttesaPerMese.slice(6).reduce((s, v) => s + v, 0);
  const usciteH1 = uscitePerMese.slice(0, 6).reduce((s, v) => s + v, 0);
  const usciteH2 = uscitePerMese.slice(6).reduce((s, v) => s + v, 0);
  const ivaH1    = uscite.filter(u => u.tipo === "iva"          && u.mese < 6).reduce((s, u) => s + u.importo, 0);
  const ivaH2    = uscite.filter(u => u.tipo === "iva"          && u.mese >= 6).reduce((s, u) => s + u.importo, 0);
  const mutuoH2  = uscite.filter(u => u.tipo === "mutuo"        && u.mese >= 6).reduce((s, u) => s + u.importo, 0);
  const antiH2   = uscite.filter(u => u.tipo === "anticipo_soci"&& u.mese >= 6).reduce((s, u) => s + u.importo, 0);
  const fornH2   = uscite.filter(u => u.tipo === "fornitore"    && u.mese >= 6).reduce((s, u) => s + u.importo, 0);
  const abbH2    = uscite.filter(u => u.tipo === "abbonamento"  && u.mese >= 6).reduce((s, u) => s + u.importo, 0);
  const ritH2    = uscite.filter(u => u.tipo === "ritenuta"     && u.mese >= 6).reduce((s, u) => s + u.importo, 0);

  const saldoConservativo  = SALDO_INIZIALE - totaleUscite;
  const saldoOttimistico   = SALDO_INIZIALE + totaleEntrateAttese - totaleUscite;

  // Running balance mensile: uscite certe + entrate attese da fatture Inviata (+30gg)
  const righe: { mese: number; entrate: number; entrateDettaglio: { nome: string; importo: number }[]; uscite: number; saldo: number; passato: boolean; usciteDettaglio: Uscita[] }[] = [];
  let running = SALDO_INIZIALE;
  for (let m = meseCorrente; m <= 11; m++) {
    const usciteMese = uscitePerMese[m];
    const entrateMese = entrateAttesaPerMese[m];
    running += entrateMese;
    running -= usciteMese;
    righe.push({
      mese: m,
      entrate: entrateMese,
      entrateDettaglio: entrateDettaglioPerMese[m],
      uscite: usciteMese,
      saldo: running,
      passato: false,
      usciteDettaglio: uscite.filter(u => u.mese === m),
    });
  }

  return {
    noteAnticipo,
    incassatoYTD, incassatoPerMese, meseCorrente,
    daIncassare, daIncassareFuoriAnno,
    totaleEntrateAttese,
    uscite,
    totaleIVA2026, totaleMutuo2026, totaleFornitore2026, totaleAnticipo2026, totaleRitenuta2026, totaleAbbonamenti2026, totaleUscite,
    saldoConservativo, saldoOttimistico,
    righe,
    incassatoH1, incassatoH2, entrateAttesaH1, entrateAttesaH2,
    usciteH1, usciteH2, ivaH1, ivaH2, mutuoH2, antiH2, fornH2, abbH2, ritH2,
    saldoAttuale: SALDO_INIZIALE,
  };
}

export default async function PrevisioneAnnualePage() {
  const {
    noteAnticipo,
    incassatoYTD, meseCorrente,
    daIncassare, daIncassareFuoriAnno,
    totaleEntrateAttese,
    uscite,
    totaleIVA2026, totaleMutuo2026, totaleFornitore2026, totaleAnticipo2026, totaleRitenuta2026, totaleAbbonamenti2026, totaleUscite,
    saldoConservativo, saldoOttimistico,
    righe,
    incassatoH1, incassatoH2, entrateAttesaH1, entrateAttesaH2,
    usciteH1, usciteH2, ivaH1, ivaH2, mutuoH2, antiH2, fornH2, abbH2, ritH2,
    saldoAttuale,
  } = await getData();

  return (
    <div>
      <PageHeader
        title={`Previsione ${ANNO}`}
        subtitle={`${MESI_FULL[meseCorrente]} → Dicembre ${ANNO} · saldo attuale ${formatEuro(saldoAttuale)}`}
      />
      <TabNav tabs={[
        { href: "/previsione", label: "Previsione anno", active: true },
        { href: "/simulazione", label: "Simula scenario", active: false },
      ]} />

      {/* Entrate / Uscite stat cards */}
      <div className="grid-2col" style={{ marginBottom: "1.75rem" }}>
        {/* Entrate */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase" }}>
              Entrate
            </div>
            <div style={{ display: "flex", gap: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.52rem", color: "var(--muted-2)" }}>
              <span style={{ color: "#00c864" }}>● reale</span>
              <span style={{ color: "var(--accent)" }}>● impegno</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#00c864", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.52rem", color: "var(--muted-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Reale</span>
            </div>
            <RigaValore label="Incassato YTD" value={formatEuro(incassatoYTD)} color="var(--sage)" note={`fatture già incassate nel ${ANNO} · netto ritenuta IRPEF`} />
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.25rem" }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.52rem", color: "var(--muted-2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Impegni</span>
            </div>
            <RigaValore
              label="Da incassare"
              value={formatEuro(Math.round(daIncassare))}
              color="var(--accent)"
              note={daIncassareFuoriAnno > 0
                ? `netto ritenuta · ${formatEuro(Math.round(daIncassareFuoriAnno))} fuori ${ANNO} (esclusi dalla timeline)`
                : "netto ritenuta IRPEF · Inviata + Da inviare con data attesa"}
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
            <RigaValore label="Anticipo soci" value={formatEuro(totaleAnticipo2026)} color="var(--accent)" note={noteAnticipo} />
            <RigaValore label="IVA (Q2 + Q3)" value={formatEuro(totaleIVA2026)} color="#ff4444" note="versamenti trimestrali" />
            <RigaValore label="Mutuo" value={formatEuro(Math.round(totaleMutuo2026 * 100) / 100)} color="var(--muted)" note="rate fino a dicembre" />
            <RigaValore label="Fornitori da pagare" value={formatEuro(totaleFornitore2026)} color="#ffb400" note="fatture ricevute con scadenza" />
            {totaleAbbonamenti2026 > 0 && (
              <RigaValore label="Abbonamenti ricorrenti" value={formatEuro(Math.round(totaleAbbonamenti2026 * 100) / 100)} color="var(--muted)" note="Google Workspace + altri mensili" />
            )}
            {totaleRitenuta2026 > 0 && (
              <RigaValore label="Ritenute d'acconto" value={formatEuro(Math.round(totaleRitenuta2026 * 100) / 100)} color="#e05555" note="da versare entro il 15 del mese succ." />
            )}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
              <RigaValore label="Totale uscite" value={formatEuro(Math.round(totaleUscite * 100) / 100)} color="var(--text)" bold />
            </div>
          </div>
        </div>
      </div>

      {/* Saldo proiettato fine anno */}
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <div className="stat-card">
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Fido bancario
          </div>
          <div className="num" style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--muted)" }}>
            {formatEuro(FIDO_BANCARIO)}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
            linea di credito disponibile
          </div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--accent-border)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Liquidità totale
          </div>
          <div className="num" style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--accent)" }}>
            {formatEuro(saldoAttuale + FIDO_BANCARIO)}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
            saldo attuale + fido
          </div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--border-hover)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Saldo conservativo
          </div>
          <div className="num" style={{ fontSize: "1.3rem", fontWeight: 700, color: (saldoConservativo + FIDO_BANCARIO) < 0 ? "#ff4444" : (saldoConservativo + FIDO_BANCARIO) < 3000 ? "#ffb400" : "var(--text)" }}>
            {formatEuro(Math.round(saldoConservativo))}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
            con fido: {formatEuro(Math.round(saldoConservativo) + FIDO_BANCARIO)}
          </div>
        </div>
        <div className="stat-card" style={{ borderColor: "var(--accent-border)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Saldo ottimistico
          </div>
          <div className="num" style={{ fontSize: "1.3rem", fontWeight: 700, color: (saldoOttimistico + FIDO_BANCARIO) < 0 ? "#ff4444" : (saldoOttimistico + FIDO_BANCARIO) < 3000 ? "#ffb400" : "var(--sage)" }}>
            {formatEuro(Math.round(saldoOttimistico))}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
            se incassi tutto · Inviata + Da inviare con data · con fido: {formatEuro(Math.round(saldoOttimistico) + FIDO_BANCARIO)}
          </div>
        </div>
      </div>

      {/* Riepilogo per semestre */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Riepilogo per semestre
      </div>
      <div className="grid-2col" style={{ marginBottom: "2rem" }}>
        {/* H1 */}
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", padding: "1rem 1.25rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            1° Semestre — Gen → Giu
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            <RigaValore label="Incassato" value={formatEuro(Math.round(incassatoH1))} color="var(--sage)" note="netto ritenuta · fatture pagate H1" />
            {entrateAttesaH1 > 0 && (
              <RigaValore label="Entrate attese (in corso)" value={formatEuro(Math.round(entrateAttesaH1))} color="var(--accent)" note="+30gg da dataInvio · mese corrente" />
            )}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.45rem" }}>
              <RigaValore label="Uscite pianificate H1" value={formatEuro(Math.round(usciteH1))} color="#ff4444" />
            </div>
            {ivaH1 > 0 && <RigaValore label="  di cui IVA" value={formatEuro(Math.round(ivaH1))} color="var(--muted)" note="versamenti trimestrali Q1–Q2" />}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.45rem" }}>
              <RigaValore label="Netto H1" value={formatEuro(Math.round(incassatoH1 + entrateAttesaH1 - usciteH1))} color={(incassatoH1 + entrateAttesaH1 - usciteH1) >= 0 ? "var(--sage)" : "#ff4444"} bold />
            </div>
          </div>
        </div>

        {/* H2 */}
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", padding: "1rem 1.25rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            2° Semestre — Lug → Dic
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {incassatoH2 > 0 && (
              <RigaValore label="Già incassato H2" value={formatEuro(Math.round(incassatoH2))} color="var(--sage)" />
            )}
            <RigaValore label="Entrate attese" value={formatEuro(Math.round(entrateAttesaH2))} color="var(--accent)" note="● impegni — +30gg da dataInvio · fatture Inviata" />
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.45rem" }}>
              <RigaValore label="Uscite pianificate H2" value={formatEuro(Math.round(usciteH2))} color="#ff4444" />
            </div>
            {ivaH2 > 0    && <RigaValore label="  di cui IVA Q3" value={formatEuro(Math.round(ivaH2))}    color="var(--muted)" />}
            {mutuoH2 > 0  && <RigaValore label="  di cui Mutuo"  value={formatEuro(Math.round(mutuoH2))}  color="var(--muted)" />}
            {antiH2 > 0   && <RigaValore label="  di cui Anticipo soci" value={formatEuro(Math.round(antiH2))} color="var(--muted)" />}
            {fornH2 > 0   && <RigaValore label="  di cui Fornitori" value={formatEuro(Math.round(fornH2))} color="var(--muted)" />}
            {abbH2 > 0    && <RigaValore label="  di cui Ricorrenti" value={formatEuro(Math.round(abbH2))} color="var(--muted)" />}
            {ritH2 > 0    && <RigaValore label="  di cui Ritenute" value={formatEuro(Math.round(ritH2))}   color="var(--muted)" />}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.45rem" }}>
              <RigaValore label="Netto H2" value={formatEuro(Math.round(incassatoH2 + entrateAttesaH2 - usciteH2))} color={(incassatoH2 + entrateAttesaH2 - usciteH2) >= 0 ? "var(--sage)" : "#ff4444"} bold />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline mensile */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Proiezione mensile — entrate attese + uscite certe
      </div>
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden", marginBottom: "2rem" }}>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Mese</th>
                <th className="col-hide-mobile">Movimenti</th>
                <th>Netto mese</th>
                <th>Saldo fine mese</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>Oggi</td>
                <td className="col-hide-mobile"></td>
                <td></td>
                <td><span className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{formatEuro(saldoAttuale)}</span></td>
              </tr>
              {righe.map((r) => (
                <tr key={r.mese} style={r.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } : {}}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" }}>
                    {MESI_FULL[r.mese]}
                  </td>
                  <td className="col-hide-mobile">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {r.entrateDettaglio.map((e, i) => (
                        <span key={`e-${i}`} style={{ fontFamily: "var(--font-mono)", fontSize: "0.55rem", background: "rgba(0,200,100,0.06)", border: "1px solid rgba(0,200,100,0.25)", borderRadius: "3px", padding: "0.2rem 0.45rem", color: "#00c864" }}>
                          ↑ {e.nome} {formatEuro(e.importo)}
                        </span>
                      ))}
                      {r.usciteDettaglio.map((u, i) => (
                        <span key={`u-${i}`} className={`badge ${u.tipo === "iva" || u.tipo === "ritenuta" ? "badge-error" : u.tipo === "mutuo" || u.tipo === "abbonamento" ? "badge-neutral" : u.tipo === "anticipo_soci" ? "badge-accent" : "badge-warning"}`} style={{ fontSize: "0.55rem" }}>
                          {u.tipo === "iva" ? u.label.split("—")[0].trim() : u.tipo === "ritenuta" ? "Ritenuta" : u.tipo === "mutuo" ? "Mutuo" : u.tipo === "anticipo_soci" ? "Anticipo" : u.tipo === "abbonamento" ? u.label : u.label} {formatEuro(u.importo)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {(r.entrate > 0 || r.uscite > 0) ? (
                      <span className="num" style={{ color: r.entrate >= r.uscite ? "#00c864" : "#ff4444" }}>
                        {r.entrate >= r.uscite ? "+" : "−"}{formatEuro(Math.abs(Math.round((r.entrate - r.uscite) * 100) / 100))}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted-2)", fontSize: "0.7rem" }}>—</span>
                    )}
                  </td>
                  <td>
                    <span className="num" style={{ color: r.saldo < 0 ? "#ff4444" : r.saldo < 2000 ? "#ffb400" : "var(--text)", fontWeight: 600 }}>
                      {formatEuro(Math.round(r.saldo))}
                    </span>
                  </td>
                </tr>
              ))}
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
                        <span className={`badge ${u.tipo === "iva" || u.tipo === "ritenuta" ? "badge-error" : u.tipo === "mutuo" || u.tipo === "abbonamento" ? "badge-neutral" : u.tipo === "anticipo_soci" ? "badge-accent" : "badge-warning"}`} style={{ fontSize: "0.58rem" }}>
                          {u.tipo === "iva" ? "IVA" : u.tipo === "ritenuta" ? "Ritenuta" : u.tipo === "mutuo" ? "Mutuo" : u.tipo === "anticipo_soci" ? "Anticipo" : u.tipo === "abbonamento" ? "Ricorrente" : "Fattura"}
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

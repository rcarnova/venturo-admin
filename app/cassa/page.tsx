import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, scadenzaRitenuta, calcolaIVACreditoPerTrimestre, calcolaTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import { SALDO_BASE, MUTUO, COSTI_RICORRENTI, FIDO_BANCARIO } from "@/lib/config";
import { getAnticipiSoci } from "@/lib/anticipi";

export const revalidate = 0;

type Flusso = {
  id: string;
  data: Date;
  dataStr: string;
  label: string;
  importo: number;
  tipo: "entrata" | "uscita_fornitore" | "iva" | "mutuo" | "anticipo_soci" | "ritenuta" | "abbonamento";
  certo: boolean;
};

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

  const SALDO_INIZIALE = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data);

  const flussi: Flusso[] = [];

  // Helper: data di incasso prevista per una fattura Inviata
  // Priorità: campo Notion "Data incasso atteso" > dataInvio+30gg > oggi+30gg
  function dataIncassoAttesaOf(f: { dataIncassoAtteso: string | null; dataInvio: string | null }, ref: Date): Date {
    if (f.dataIncassoAtteso) return new Date(f.dataIncassoAtteso + "T00:00:00");
    const base = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(ref);
    base.setDate(base.getDate() + 30);
    return base;
  }

  // Entrate attese — fatture "Inviata"
  const fattureAttese = fatture.filter((f) => f.status === "Inviata");
  const totaleAttesoAll = fattureAttese.reduce((s, f) => s + f.incassoNetto, 0);

  // Uscite certe — fatture ricevute da pagare (Ricevuta) o scadute (In ritardo)
  for (const f of ricevute) {
    if ((f.status !== "Ricevuta" && f.status !== "In ritardo") || !f.scadenza) continue;
    const d = new Date(f.scadenza);
    d.setHours(0, 0, 0, 0);
    const scaduta = d < today;
    const dataEffettiva = scaduta ? new Date(today) : d;
    flussi.push({
      id: `fr-${f.id}`,
      data: dataEffettiva,
      dataStr: scaduta ? `oggi (sc. ${d.toLocaleDateString("it-IT")})` : d.toLocaleDateString("it-IT"),
      label: scaduta ? `${f.nome} ⚠ scaduta` : f.nome,
      importo: -f.importo,
      tipo: "uscita_fornitore",
      certo: true,
    });
  }

  // Ritenuta d'acconto — da versare entro il 15 del mese successivo al pagamento (importoRitenuta da SDI/Notion)
  for (const f of ricevute) {
    if (!f.importoRitenuta) continue;
    const dataBase = f.dataPagamento ? new Date(f.dataPagamento)
      : f.scadenza ? (new Date(f.scadenza) < today ? new Date(today) : new Date(f.scadenza))
      : null;
    if (!dataBase) continue;
    const scad = scadenzaRitenuta(dataBase);
    if (scad < today) continue;
    flussi.push({
      id: `ritenuta-${f.id}`,
      data: scad,
      dataStr: scad.toLocaleDateString("it-IT"),
      label: `Ritenuta ${f.nome}`,
      importo: -f.importoRitenuta,
      tipo: "ritenuta",
      certo: true,
    });
  }

  // Uscite IVA — debito da fatture emesse meno credito da acquisti
  const ANNO_CORRENTE = today.getFullYear();
  const ivaPerTrimestre = new Map<string, { certo: number; atteso: number }>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      const prev = ivaPerTrimestre.get(f.trimestreIVA) ?? { certo: 0, atteso: 0 };
      ivaPerTrimestre.set(f.trimestreIVA, { ...prev, certo: prev.certo + f.iva22 });
    }
  }
  // IVA attesa da fatture Inviata — usa dataIncassoAtteso se presente, altrimenti +30gg
  // EDGE-06: se la data prevista è nel passato, usa oggi per il trimestre (evita Q già chiusi)
  for (const f of fattureAttese) {
    const d = dataIncassoAttesaOf(f, today);
    const datePerTrimestre = d < today ? new Date(today) : d;
    const trim = calcolaTrimestre(datePerTrimestre.toISOString().split("T")[0]);
    if (!trim) continue;
    const prev = ivaPerTrimestre.get(trim) ?? { certo: 0, atteso: 0 };
    ivaPerTrimestre.set(trim, { ...prev, atteso: prev.atteso + f.iva22 });
  }
  const ivaCredito = calcolaIVACreditoPerTrimestre(ricevute, COSTI_RICORRENTI, ANNO_CORRENTE);
  for (const [trimestre, { certo: ivaDebCerto, atteso: ivaDebAtteso }] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const scadenzaDate = new Date(y, m - 1, d);
    scadenzaDate.setHours(0, 0, 0, 0);
    if (scadenzaDate < today) continue; // già versata
    const creditoTrimestre = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
    const ivaNetta = Math.max(0, Math.round((ivaDebCerto + ivaDebAtteso - creditoTrimestre) * 100) / 100);
    const noteCredito = creditoTrimestre > 0 ? ` (−${formatEuro(creditoTrimestre)} credito)` : "";
    const noteAtteso = ivaDebAtteso > 0 ? ` · +${formatEuro(ivaDebAtteso)} attesa` : "";
    flussi.push({
      id: `iva-${trimestre}`,
      data: scadenzaDate,
      dataStr: scadenzaStr,
      label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}${noteCredito}${noteAtteso}`,
      importo: -ivaNetta,
      tipo: "iva",
      certo: ivaDebCerto > 0, // incerto se solo da fatture attese
    });
  }

  // Rate mutuo nei prossimi 90 giorni
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata);
    d.setMonth(d.getMonth() + i);
    d.setHours(0, 0, 0, 0);
    if (d > in90) break;
    if (d >= today) {
      flussi.push({
        id: `mutuo-${i}`,
        data: d,
        dataStr: d.toLocaleDateString("it-IT"),
        label: `Rata mutuo (${i + 1}/${MUTUO.nRateRimanenti})`,
        importo: -MUTUO.importoRata,
        tipo: "mutuo",
        certo: true,
      });
    }
  }

  // Anticipo soci — rate pianificate (da Notion se configurato, altrimenti config.ts)
  anticipiSoci.forEach((a, i) => {
    const d = new Date(a.data); d.setHours(0, 0, 0, 0);
    if (d < today || d > in90) return;
    flussi.push({
      id: `anticipo-${i}`,
      data: d,
      dataStr: d.toLocaleDateString("it-IT"),
      label: "Anticipo soci",
      importo: -a.importo,
      tipo: "anticipo_soci",
      certo: true,
    });
  });

  // Costi ricorrenti (mensili e non)
  for (const costo of COSTI_RICORRENTI) {
    const importoLordo = Math.round(costo.importoNetto * (1 + costo.aliquotaIVA) * 100) / 100;
    const freq = costo.frequenzaMesi ?? 1;
    for (let mo = 0; mo <= 4; mo++) {
      const targetAnno = today.getFullYear() + Math.floor((today.getMonth() + mo) / 12);
      const targetMese = (today.getMonth() + mo) % 12;
      if (freq > 1 && costo.primaData) {
        const diff = (targetAnno - costo.primaData.anno) * 12 + (targetMese - costo.primaData.mese);
        if (diff < 0 || diff % freq !== 0) continue;
      }
      const lastDay = new Date(targetAnno, targetMese + 1, 0).getDate();
      const d = new Date(targetAnno, targetMese, Math.min(costo.giornoAddebito, lastDay));
      d.setHours(0, 0, 0, 0);
      if (d < today || d > in90) continue;
      flussi.push({
        id: `ricorrente-${costo.label}-${mo}`,
        data: d,
        dataStr: d.toLocaleDateString("it-IT"),
        label: costo.label,
        importo: -importoLordo,
        tipo: "abbonamento",
        certo: true,
      });
    }
  }

  // Entrate attese: Inviata con data prevista → incasso in timeline
  // Usa dataIncassoAtteso se presente, altrimenti dataInvio+30gg; skip se nessun riferimento
  const fattureSenzaData: typeof fattureAttese = [];
  for (const f of fattureAttese) {
    if (!f.dataIncassoAtteso && !f.dataInvio) { fattureSenzaData.push(f); continue; }
    const d = dataIncassoAttesaOf(f, today);
    d.setHours(0, 0, 0, 0);
    const dataEff = d < today ? new Date(today) : d;
    const labelData = f.dataIncassoAtteso
      ? dataEff.toLocaleDateString("it-IT")
      : `${dataEff.toLocaleDateString("it-IT")} (+30gg)`;
    flussi.push({
      id: `entrata-${f.id}`,
      data: dataEff,
      dataStr: labelData,
      label: f.nome,
      importo: f.incassoNetto,
      tipo: "entrata",
      certo: false,
    });
  }

  // Inviata senza alcuna data prevista → aggregato senza timeline
  const totaleAtteso = fattureSenzaData.reduce((s, f) => s + f.incassoNetto, 0);

  // Rimborsi spese aperti
  const totRimborsi = note.filter((n) => n.statusRimborso === "Da rimborsare").reduce((s, n) => s + n.importo, 0);

  flussi.sort((a, b) => a.data.getTime() - b.data.getTime());

  // Proiezione: saldo nel tempo con sole uscite certe
  let saldoMinimo = SALDO_INIZIALE;
  let saldoMinPoint = SALDO_INIZIALE;
  for (const f of flussi.filter((x) => x.certo)) {
    saldoMinimo += f.importo;
    if (saldoMinimo < saldoMinPoint) saldoMinPoint = saldoMinimo;
  }

  // Proiezione ottimistica: uscite certe + tutte le entrate attese
  const saldoOttimistico = SALDO_INIZIALE + totaleAtteso + flussi.reduce((s, f) => s + f.importo, 0);

  // Flussi nei prossimi 90 giorni — IVA sempre inclusa perché scadenza fissa
  const flussi90 = flussi.filter((f) => f.data <= in90 || f.tipo === "iva");

  return { flussi90, flussiTutti: flussi, fattureAttese: fattureSenzaData, totaleAttesoAll, totaleAtteso, totRimborsi, saldoMinimo, saldoOttimistico, saldoAttuale: SALDO_INIZIALE };
}

export default async function CassaPage() {
  const { flussi90, fattureAttese, totaleAtteso, totaleAttesoAll, totRimborsi, saldoMinimo, saldoOttimistico, saldoAttuale } = await getData();

  const totUscite90 = flussi90.filter((f) => f.importo < 0).reduce((s, f) => s + Math.abs(f.importo), 0);
  const liquiditaTotale = saldoAttuale + FIDO_BANCARIO;
  const alertSaldo = (saldoOttimistico + FIDO_BANCARIO) < 0;

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
        subtitle={`Prossimi 90 giorni + scadenze IVA · saldo attuale ${formatEuro(saldoAttuale)}`}
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
        <SaldoCard label="Entrate attese" value={formatEuro(totaleAttesoAll)} color="#00c864" note="fatture inviate" tier="impegno" />
        <SaldoCard label="Uscite certe (90gg)" value={formatEuro(totUscite90)} color="#ffb400" tier="impegno" />
        <SaldoCard
          label="Saldo minimo garantito"
          value={formatEuro(saldoMinimo)}
          color={(saldoMinimo + FIDO_BANCARIO) < 0 ? "#ff4444" : (saldoMinimo + FIDO_BANCARIO) < 2000 ? "#ffb400" : "var(--text)"}
          note={`con fido: ${formatEuro(saldoMinimo + FIDO_BANCARIO)}`}
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

      {alertSaldo && (
        <div style={{ background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.3)", borderRadius: "6px", padding: "0.75rem 1.25rem", marginBottom: "1.5rem", fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "#ff4444" }}>
          ⚠ Attenzione: il saldo va in negativo anche considerando le entrate attese. Verifica la liquidità.
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
          Proiezione flussi — prossimi 90 giorni
        </div>
        <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
        <div style={{ display: "flex", gap: "0.75rem", fontFamily: "var(--font-mono)", fontSize: "0.52rem", color: "var(--muted-2)" }}>
          <span style={{ borderLeft: "2px solid rgba(0,200,100,0.5)", paddingLeft: "0.35rem" }}>incasso stimato</span>
          <span style={{ borderLeft: "2px solid rgba(255,60,60,0.4)", paddingLeft: "0.35rem" }}>uscita certa</span>
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
              {steps.map((s) => (
                <tr key={s.id} style={
                  s.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } :
                  s.importo > 0 ? { background: "rgba(0,200,100,0.025)", boxShadow: "inset 2px 0 0 rgba(0,200,100,0.35)" } : {}
                }>
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
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
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

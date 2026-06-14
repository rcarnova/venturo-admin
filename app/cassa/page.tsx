import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, scadenzaRitenuta, calcolaIVACreditoPerTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import { SALDO_BASE, MUTUO, ANTICIPO_SOCI, COSTI_RICORRENTI, FIDO_BANCARIO } from "@/lib/config";

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
  const [fatturePages, ricevutePages, notePages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.NOTE_SPESE),
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

  // Entrate attese — fatture "Inviata" (certe ma senza data)
  const fattureAttese = fatture.filter((f) => f.status === "Inviata");
  const totaleAtteso = fattureAttese.reduce((s, f) => s + f.incassoNetto, 0);

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
  const ivaPerTrimestre = new Map<string, number>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre.set(f.trimestreIVA, (ivaPerTrimestre.get(f.trimestreIVA) ?? 0) + f.iva22);
    }
  }
  const ivaCredito = calcolaIVACreditoPerTrimestre(ricevute, COSTI_RICORRENTI, ANNO_CORRENTE);
  for (const [trimestre, ivaDebito] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const scadenzaDate = new Date(y, m - 1, d);
    scadenzaDate.setHours(0, 0, 0, 0);
    if (scadenzaDate < today) continue; // già versata
    const creditoTrimestre = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
    const ivaNetta = Math.max(0, Math.round((ivaDebito - creditoTrimestre) * 100) / 100);
    const noteCredito = creditoTrimestre > 0 ? ` (−${creditoTrimestre.toFixed(2)} credito)` : "";
    flussi.push({
      id: `iva-${trimestre}`,
      data: scadenzaDate,
      dataStr: scadenzaStr,
      label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}${noteCredito}`,
      importo: -ivaNetta,
      tipo: "iva",
      certo: true,
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

  // Anticipo soci — rate pianificate
  ANTICIPO_SOCI.forEach((a, i) => {
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

  return { flussi90, flussiTutti: flussi, fattureAttese, totaleAtteso, totRimborsi, saldoMinimo, saldoOttimistico, saldoAttuale: SALDO_INIZIALE };
}

export default async function CassaPage() {
  const { flussi90, fattureAttese, totaleAtteso, totRimborsi, saldoMinimo, saldoOttimistico, saldoAttuale } = await getData();

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
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <SaldoCard label="Saldo attuale" value={formatEuro(saldoAttuale)} color="var(--text)" />
        <SaldoCard label="Fido bancario" value={formatEuro(FIDO_BANCARIO)} color="var(--muted)" note="linea di credito disponibile" />
        <SaldoCard label="Liquidità totale" value={formatEuro(liquiditaTotale)} color="var(--accent)" note="saldo + fido" />
        <SaldoCard label="Entrate attese" value={formatEuro(totaleAtteso)} color="#00c864" note={`${fattureAttese.length} fatture inviata`} />
        <SaldoCard label="Uscite certe (90gg)" value={formatEuro(totUscite90)} color="#ffb400" />
        <SaldoCard
          label="Saldo minimo garantito"
          value={formatEuro(saldoMinimo)}
          color={(saldoMinimo + FIDO_BANCARIO) < 0 ? "#ff4444" : (saldoMinimo + FIDO_BANCARIO) < 2000 ? "#ffb400" : "var(--text)"}
          note={`con fido: ${formatEuro(saldoMinimo + FIDO_BANCARIO)}`}
        />
        <SaldoCard
          label="Saldo ottimistico"
          value={formatEuro(saldoOttimistico)}
          color="var(--accent)"
          note="se incassi tutto"
        />
        <SaldoCard
          label="Mutuo residuo"
          value={formatEuro(MUTUO.totaleRimanente)}
          color="var(--muted)"
          note={`${MUTUO.nRateRimanenti} rate · €${MUTUO.importoRata.toFixed(2)}/mese`}
        />
        {totRimborsi > 0 && (
          <SaldoCard label="Rimborsi aperti" value={formatEuro(totRimborsi)} color="#ffb400" note="non inclusi nelle uscite" />
        )}
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
            Entrate attese — non ancora incassate
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

      {/* Timeline uscite */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Timeline uscite nei prossimi 90 giorni
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
                <tr key={s.id} style={s.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } : {}}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>{s.dataStr}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 500 }}>{s.label}</td>
                  <td className="col-hide-mobile">
                    <span className={`badge ${s.tipo === "iva" ? "badge-error" : s.tipo === "ritenuta" ? "badge-error" : s.tipo === "mutuo" ? "badge-neutral" : s.tipo === "anticipo_soci" ? "badge-accent" : s.tipo === "abbonamento" ? "badge-neutral" : "badge-warning"}`} style={{ fontSize: "0.58rem" }}>
                      {s.tipo === "iva" ? "IVA" : s.tipo === "ritenuta" ? "Ritenuta" : s.tipo === "mutuo" ? "Mutuo" : s.tipo === "anticipo_soci" ? "Anticipo" : s.tipo === "abbonamento" ? "Ricorrente" : "Fattura"}
                    </span>
                  </td>
                  <td><span className="num" style={{ color: "#ff4444" }}>{formatEuro(Math.abs(s.importo))}</span></td>
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

function SaldoCard({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <div className="stat-card">
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

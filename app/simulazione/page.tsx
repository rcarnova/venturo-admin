import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapDeal } from "@/lib/notion";
import { scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, scadenzaRitenuta, calcolaIVACreditoPerTrimestre, toDateStr, calcolaTrimestre } from "@/lib/utils";
import { SALDO_BASE, MUTUO, COSTI_RICORRENTI, FIDO_BANCARIO, IVA_VERSAMENTI } from "@/lib/config";
import { getAnticipiSoci } from "@/lib/anticipi";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import SimulazioneClient from "@/components/simulazione/SimulazioneClient";

export const revalidate = 0;

const ANNO = new Date().getFullYear();

export type UscitaFissa = { mese: number; importo: number; label: string; tipo: string };

async function getData() {
  const [fatturePages, ricevutePages, pipelinePages, anticipiSoci] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.PIPELINE),
    getAnticipiSoci(),
  ]);

  const fatture  = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);
  const deals    = pipelinePages.map(mapDeal);

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const fineAnno = new Date(ANNO, 11, 31, 23, 59, 59);
  const meseCorrente = today.getMonth();
  const semestre = meseCorrente < 6 ? 1 : 2;
  const fattore  = semestre === 1 ? 1.0 : 0.5;

  const saldoAttuale = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data);

  // Entrate attese — "Inviata" + "Da inviare" con dataIncassoAtteso (coerente con cassa e previsione)
  const daIncassare = Math.round(
    fatture
      .filter(f => f.status === "Inviata" || (f.status === "Da inviare" && f.dataIncassoAtteso != null))
      .reduce((s, f) => s + f.incassoNetto, 0)
  );
  const wonDeals = deals.filter(d => d.status === "Won");
  const totaleVenduto = wonDeals.reduce((s, d) => s + d.valore, 0);
  const totaleFatturato = fatture.reduce((s, f) => s + f.importo, 0);
  const daFatturareWon = Math.round(Math.max(0, totaleVenduto - totaleFatturato) * fattore);

  // Uscite fisse (IVA, mutuo, fornitori) senza anticipi soci
  const usciteFisse: UscitaFissa[] = [];

  // IVA — debito meno credito acquisti
  const fattureInForecast = fatture.filter(f =>
    f.status === "Inviata" || (f.status === "Da inviare" && f.dataIncassoAtteso != null)
  );
  const ivaPerTrimestre = new Map<string, number>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre.set(f.trimestreIVA, (ivaPerTrimestre.get(f.trimestreIVA) ?? 0) + f.iva22);
    }
  }
  // IVA attesa dagli incassi previsti: il trimestre segue la data di incasso
  for (const f of fattureInForecast) {
    let d = f.dataIncassoAtteso
      ? new Date(f.dataIncassoAtteso + "T00:00:00")
      : (() => { const b = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(today); b.setDate(b.getDate() + 30); return b; })();
    if (d < today) d = new Date(today);
    const trim = calcolaTrimestre(toDateStr(d));
    if (!trim) continue;
    ivaPerTrimestre.set(trim, (ivaPerTrimestre.get(trim) ?? 0) + f.iva22);
  }
  // "Da ricevere" esclusa (IVA non ancora pagata), reverse charge escluso (nessuna IVA versata)
  const ricevutePerIVA = ricevute.filter(f => f.status !== "Da ricevere" && !f.reverseCharge);
  const ivaCredito = calcolaIVACreditoPerTrimestre(ricevutePerIVA, COSTI_RICORRENTI, ANNO);
  for (const [trimestre, ivaDebito] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const sc = new Date(y, m - 1, d); sc.setHours(0, 0, 0, 0);
    if (sc < today || sc > fineAnno) continue;
    const creditoTrimestre = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
    const ivaNetta = IVA_VERSAMENTI[trimestre] ?? Math.max(0, Math.round((ivaDebito - creditoTrimestre) * 100) / 100);
    const noteCredito = IVA_VERSAMENTI[trimestre] ? " · da commercialista" : creditoTrimestre > 0 ? ` (−${creditoTrimestre.toFixed(2)} credito)` : "";
    usciteFisse.push({ mese: sc.getMonth(), importo: ivaNetta, label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}${noteCredito}`, tipo: "iva" });
  }

  // Mutuo
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata); d.setMonth(d.getMonth() + i); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    usciteFisse.push({ mese: d.getMonth(), importo: MUTUO.importoRata, label: "Rata mutuo", tipo: "mutuo" });
  }

  // Fornitori — da pagare, scadute, attese, e pagate su carta con addebito banca futuro
  const oggiStr = toDateStr(today);
  for (const f of ricevute) {
    // "Pagata" con data futura = addebito carta noto, non ancora uscito dal conto
    const pagataFutura = f.status === "Pagata" && f.dataPagamento != null && f.dataPagamento > oggiStr;
    const statoOk = f.status === "Ricevuta" || f.status === "In ritardo" || f.status === "Da ricevere" || pagataFutura;
    const dataRif = pagataFutura ? f.dataPagamento : f.scadenza;
    if (!statoOk || !dataRif) continue;
    const d = new Date(dataRif); d.setHours(0, 0, 0, 0);
    if (d > fineAnno) continue;
    const dataEffettiva = d < today ? today : d;
    usciteFisse.push({ mese: dataEffettiva.getMonth(), importo: f.importo, label: f.nome, tipo: "fornitore" });
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
      usciteFisse.push({ mese: m, importo: importoLordo, label: costo.label, tipo: "abbonamento" });
    }
  }

  // Ritenute d'acconto (importoRitenuta da SDI/Notion — non usa fallback su % fornitore)
  for (const f of ricevute) {
    if (!f.importoRitenuta) continue;
    const dataBase = f.dataPagamento ? new Date(f.dataPagamento)
      : f.scadenza ? (new Date(f.scadenza) < today ? new Date(today) : new Date(f.scadenza))
      : null;
    if (!dataBase) continue;
    const scad = scadenzaRitenuta(dataBase);
    if (scad < today || scad > fineAnno) continue;
    usciteFisse.push({ mese: scad.getMonth(), importo: f.importoRitenuta, label: `Ritenuta ${f.nome}`, tipo: "ritenuta" });
  }

  // Anticipi soci — solo config.ts (modifica ANTICIPO_SOCI in lib/config.ts)
  const anticipoDefault = anticipiSoci
    .filter(a => { const d = new Date(a.data); d.setHours(0, 0, 0, 0); return d >= today && d <= fineAnno; })
    .map(a => ({ dataStr: toDateStr(new Date(a.data)), importo: a.importo }));

  return { saldoAttuale, daIncassare, daFatturareWon, usciteFisse, anticipoDefault, meseCorrente, fattore, semestre, fidoBancario: FIDO_BANCARIO };
}

export default async function SimulazionePage() {
  const data = await getData();
  return (
    <div>
      <PageHeader
        title="Previsione"
        subtitle={`Modifica importi e date per vedere l'impatto sul saldo fino a dicembre ${ANNO}`}
      />
      <TabNav tabs={[
        { href: "/previsione", label: "Previsione anno", active: false },
        { href: "/simulazione", label: "Simula scenario", active: true },
      ]} />
      <SimulazioneClient {...data} />
    </div>
  );
}

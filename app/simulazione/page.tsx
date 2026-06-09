import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapDeal, mapFornitore } from "@/lib/notion";
import { scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, scadenzaRitenuta } from "@/lib/utils";
import { SALDO_BASE, MUTUO, ANTICIPO_SOCI } from "@/lib/config";
import { PageHeader } from "@/components/shared/PageHeader";
import SimulazioneClient from "@/components/simulazione/SimulazioneClient";

export const revalidate = 0;

const ANNO = 2026;

export type UscitaFissa = { mese: number; importo: number; label: string; tipo: string };

async function getData() {
  const [fatturePages, ricevutePages, pipelinePages, fornitoriPages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.PIPELINE),
    queryAll(DB.FORNITORI),
  ]);

  const fatture      = fatturePages.map(mapFattura);
  const ricevute     = ricevutePages.map(mapFatturaRicevuta);
  const deals        = pipelinePages.map(mapDeal);
  const fornitoriMap = new Map(fornitoriPages.map(p => { const f = mapFornitore(p); return [f.id, f]; }));

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const fineAnno = new Date(ANNO, 11, 31, 23, 59, 59);
  const meseCorrente = today.getMonth();
  const semestre = meseCorrente < 6 ? 1 : 2;
  const fattore  = semestre === 1 ? 1.0 : 0.5;

  const saldoAttuale = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data);

  // Entrate attese
  const daIncassare = Math.round(
    fatture.filter(f => f.status === "Inviata").reduce((s, f) => s + f.incassoNetto, 0)
  );
  const fatturePerProgetto = new Map<string, number>();
  for (const f of fatture) {
    if (f.progetto) fatturePerProgetto.set(f.progetto, (fatturePerProgetto.get(f.progetto) ?? 0) + f.importo);
  }
  const wonDeals = deals.filter(d => d.status === "Won");
  const daFatturareWon = Math.round(wonDeals.reduce((s, d) => {
    const fatturato = d.progettoId ? (fatturePerProgetto.get(d.progettoId) ?? 0) : 0;
    return s + Math.max(0, d.valore - fatturato) * fattore;
  }, 0));

  // Uscite fisse (IVA, mutuo, fornitori) senza anticipi soci
  const usciteFisse: UscitaFissa[] = [];

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
    const sc = new Date(y, m - 1, d); sc.setHours(0, 0, 0, 0);
    if (sc < today || sc > fineAnno) continue;
    usciteFisse.push({ mese: sc.getMonth(), importo: totaleIVA, label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}`, tipo: "iva" });
  }

  // Mutuo
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata); d.setMonth(d.getMonth() + i); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    usciteFisse.push({ mese: d.getMonth(), importo: MUTUO.importoRata, label: "Rata mutuo", tipo: "mutuo" });
  }

  // Fornitori
  for (const f of ricevute) {
    if (f.status !== "Ricevuta" || !f.scadenza) continue;
    const d = new Date(f.scadenza); d.setHours(0, 0, 0, 0);
    if (d > fineAnno) continue;
    const dataEffettiva = d < today ? today : d;
    usciteFisse.push({ mese: dataEffettiva.getMonth(), importo: f.importo, label: f.nome, tipo: "fornitore" });
  }

  // Ritenute d'acconto
  for (const f of ricevute) {
    const forn = f.fornitore ? fornitoriMap.get(f.fornitore) : null;
    if (!forn?.ritenuta || !forn.percentualeRitenuta) continue;
    const importoRitenuta = Math.round(f.importo * forn.percentualeRitenuta / 100 * 100) / 100;
    const dataBase = f.dataPagamento ? new Date(f.dataPagamento)
      : f.scadenza ? (new Date(f.scadenza) < today ? new Date(today) : new Date(f.scadenza))
      : null;
    if (!dataBase) continue;
    const scad = scadenzaRitenuta(dataBase);
    if (scad < today || scad > fineAnno) continue;
    usciteFisse.push({ mese: scad.getMonth(), importo: importoRitenuta, label: `Ritenuta ${f.nome} (${forn.percentualeRitenuta}%)`, tipo: "ritenuta" });
  }

  // Valore di default anticipo soci dal config (solo date future nell'anno)
  const anticipoDefault = ANTICIPO_SOCI
    .filter(a => { const d = new Date(a.data); d.setHours(0, 0, 0, 0); return d >= today && d <= fineAnno; })
    .map(a => ({ dataStr: new Date(a.data).toISOString().split("T")[0], importo: a.importo }));

  return { saldoAttuale, daIncassare, daFatturareWon, usciteFisse, anticipoDefault, meseCorrente, fattore, semestre };
}

export default async function SimulazionePage() {
  const data = await getData();
  return (
    <div>
      <PageHeader
        title="Simulazione Anticipi Soci"
        subtitle={`Modifica importi e date per vedere l'impatto sul saldo fino a dicembre ${ANNO}`}
      />
      <SimulazioneClient {...data} />
    </div>
  );
}

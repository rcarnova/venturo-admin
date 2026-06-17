import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapDeal } from "@/lib/notion";
import { scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, scadenzaRitenuta, calcolaIVACreditoPerTrimestre } from "@/lib/utils";
import { SALDO_BASE, MUTUO, COSTI_RICORRENTI, FIDO_BANCARIO } from "@/lib/config";
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

  // Entrate attese
  const daIncassare = Math.round(
    fatture.filter(f => f.status === "Inviata").reduce((s, f) => s + f.incassoNetto, 0)
  );
  const wonDeals = deals.filter(d => d.status === "Won");
  const totaleVenduto = wonDeals.reduce((s, d) => s + d.valore, 0);
  const totaleFatturato = fatture.reduce((s, f) => s + f.importo, 0);
  const daFatturareWon = Math.round(Math.max(0, totaleVenduto - totaleFatturato) * fattore);

  // Uscite fisse (IVA, mutuo, fornitori) senza anticipi soci
  const usciteFisse: UscitaFissa[] = [];

  // IVA — debito meno credito acquisti
  const ivaPerTrimestre = new Map<string, number>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre.set(f.trimestreIVA, (ivaPerTrimestre.get(f.trimestreIVA) ?? 0) + f.iva22);
    }
  }
  const ivaCredito = calcolaIVACreditoPerTrimestre(ricevute, COSTI_RICORRENTI, ANNO);
  for (const [trimestre, ivaDebito] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const sc = new Date(y, m - 1, d); sc.setHours(0, 0, 0, 0);
    if (sc < today || sc > fineAnno) continue;
    const creditoTrimestre = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
    const ivaNetta = Math.max(0, Math.round((ivaDebito - creditoTrimestre) * 100) / 100);
    const noteCredito = creditoTrimestre > 0 ? ` (−${creditoTrimestre.toFixed(2)} credito)` : "";
    usciteFisse.push({ mese: sc.getMonth(), importo: ivaNetta, label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}${noteCredito}`, tipo: "iva" });
  }

  // Mutuo
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata); d.setMonth(d.getMonth() + i); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    usciteFisse.push({ mese: d.getMonth(), importo: MUTUO.importoRata, label: "Rata mutuo", tipo: "mutuo" });
  }

  // Fornitori — include fatture da pagare (Ricevuta) e scadute (In ritardo)
  for (const f of ricevute) {
    if ((f.status !== "Ricevuta" && f.status !== "In ritardo") || !f.scadenza) continue;
    const d = new Date(f.scadenza); d.setHours(0, 0, 0, 0);
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

  // Anticipi soci — da Notion se configurato, altrimenti config.ts (solo date future nell'anno)
  const anticipoDefault = anticipiSoci
    .filter(a => { const d = new Date(a.data); d.setHours(0, 0, 0, 0); return d >= today && d <= fineAnno; })
    .map(a => ({ dataStr: new Date(a.data).toISOString().split("T")[0], importo: a.importo }));

  const hasNotionDB = !!process.env.NOTION_DB_ANTICIPI;

  return { saldoAttuale, daIncassare, daFatturareWon, usciteFisse, anticipoDefault, meseCorrente, fattore, semestre, fidoBancario: FIDO_BANCARIO, hasNotionDB };
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

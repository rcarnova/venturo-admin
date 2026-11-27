import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapDeal } from "@/lib/notion";
import { calcolaSaldoDinamico, toDateStr } from "@/lib/utils";
import { SALDO_BASE, FIDO_BANCARIO } from "@/lib/config";
import { getAnticipiSoci } from "@/lib/anticipi";
import { calcolaFlussi } from "@/lib/flussi";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import SimulazioneClient from "@/components/simulazione/SimulazioneClient";
import SimulazioneAnnoClient, { type FlussoFisso } from "@/components/simulazione/SimulazioneAnnoClient";

export const revalidate = 0;

const ANNO = new Date().getFullYear();
const ANNO_CORRENTE = ANNO;

export type UscitaFissa = { mese: number; importo: number; label: string; tipo: string; condizionato?: boolean };

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

  const saldoAttuale = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data, anticipiSoci);

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

  const flussi = calcolaFlussi({ fatture, ricevute, anticipiSoci, today });

  // Uscite fisse (IVA, mutuo, fornitori) senza anticipi soci
  const usciteFisse: UscitaFissa[] = [];
  const TIPI: Record<string, string> = { uscita_fornitore: "fornitore", iva: "iva", mutuo: "mutuo", ritenuta: "ritenuta", abbonamento: "abbonamento" };
  for (const f of flussi) {
    if (!TIPI[f.tipo] || f.data > fineAnno) continue;
    const noteCredito = f.iva ? (f.iva.override ? " · da commercialista" : f.iva.credito > 0 ? ` (−${f.iva.credito.toFixed(2)} credito)` : "") : "";
    usciteFisse.push({ mese: f.data.getMonth(), importo: -f.importo, label: f.tipo === "mutuo" ? "Rata mutuo" : `${f.label}${noteCredito}`, tipo: TIPI[f.tipo], condizionato: f.condizionato });
  }

  // Entrate attese ripartite sul mese di incasso previsto: senza questa
  // ripartizione la proiezione mensile mostra solo uscite e descrive una crisi
  // che non esiste, perche' gli incassi compaiono tutti insieme alla fine.
  const entratePerMese = Array(12).fill(0) as number[];
  for (const f of flussi) {
    if (f.tipo === "entrata" && f.data.getFullYear() === ANNO) entratePerMese[f.data.getMonth()] += f.importo;
  }

  // Gli anticipi in ritardo restano nel piano alla data di oggi.
  const anticipoDefault = flussi
    .filter(f => f.tipo === "anticipo_soci" && f.data <= fineAnno)
    .map(f => ({ dataStr: `${f.data.getFullYear()}-${String(f.data.getMonth() + 1).padStart(2, "0")}-${String(f.data.getDate()).padStart(2, "0")}`, importo: -f.importo }));

  return { saldoAttuale, daIncassare, daFatturareWon, usciteFisse, entratePerMese, anticipoDefault, meseCorrente, fattore, semestre, fidoBancario: FIDO_BANCARIO };
}

/** Anno futuro: saldo previsto al 01/01 e flussi reali dell'anno (fino al
 *  versamento IVA di marzo dell'anno dopo), anticipi a parte perche' modificabili. */
async function getDataAnno(anno: number) {
  const [fatturePages, ricevutePages, anticipiSoci] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    getAnticipiSoci(),
  ]);
  const fatture  = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const inizio = new Date(anno, 0, 1);
  const limite = new Date(anno + 1, 2, 31);
  const saldoOggi = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data, anticipiSoci);
  const flussi = calcolaFlussi({ fatture, ricevute, anticipiSoci, today });
  const saldoIniziale = Math.round((saldoOggi + flussi.filter(f => f.data < inizio).reduce((s, f) => s + f.importo, 0)) * 100) / 100;
  const nell = flussi.filter(f => f.data >= inizio && f.data <= limite);
  const flussiFissi: FlussoFisso[] = nell
    .filter(f => f.tipo !== "anticipo_soci")
    .map(f => ({ d: toDateStr(f.data), i: f.importo, l: f.label, t: f.tipo }));
  const anticipiDefault = nell
    .filter(f => f.tipo === "anticipo_soci" && f.data.getFullYear() === anno)
    .map(f => ({ d: toDateStr(f.data), imp: -f.importo }));
  return { anno, oggi: toDateStr(today), saldoIniziale, fido: FIDO_BANCARIO, flussiFissi, anticipiDefault };
}

export default async function SimulazionePage({ searchParams }: { searchParams: { anno?: string } }) {
  const futuro = Number(searchParams?.anno) === ANNO_CORRENTE + 1;
  const tabs = [
    { href: "/previsione", label: `Previsione ${ANNO_CORRENTE}`, active: false },
    { href: `/previsione?anno=${ANNO_CORRENTE + 1}`, label: `Previsione ${ANNO_CORRENTE + 1}`, active: false },
    { href: "/simulazione", label: `Simula ${ANNO_CORRENTE}`, active: !futuro },
    { href: `/simulazione?anno=${ANNO_CORRENTE + 1}`, label: `Simula ${ANNO_CORRENTE + 1}`, active: futuro },
  ];
  if (futuro) {
    const data = await getDataAnno(ANNO_CORRENTE + 1);
    return (
      <div>
        <PageHeader
          title={`Simula ${data.anno}`}
          subtitle={`Anticipi e fatture ipotetiche sopra i flussi reali · quanto fatturato serve per restare in soglia`}
        />
        <TabNav tabs={tabs} />
        <SimulazioneAnnoClient {...data} />
      </div>
    );
  }
  const data = await getData();
  return (
    <div>
      <PageHeader
        title="Previsione"
        subtitle={`Modifica importi e date per vedere l'impatto sul saldo fino a dicembre ${ANNO}`}
      />
      <TabNav tabs={tabs} />
      <SimulazioneClient {...data} />
    </div>
  );
}

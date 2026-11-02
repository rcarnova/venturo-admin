// ─── Motore unico dei flussi di cassa ────────────────────────────────────────
// Unica fonte di verita' per entrate e uscite future. Cassa, previsione,
// simulazione, snapshot e scadenziario leggono da qui e filtrano sul proprio
// orizzonte: nessuna pagina ricalcola i flussi per conto suo.
import type { Fattura, FatturaRicevuta, AnticipoSocio } from "./types";
import { COSTI_RICORRENTI, IVA_VERSAMENTI, MUTUO } from "./config";
import {
  calcolaIVACreditoPerTrimestre, periodoTrimestre, scadenzaRitenuta,
  scadenzaVersamentoIVA, toDateStr,
} from "./utils";

export type TipoFlusso =
  | "entrata" | "uscita_fornitore" | "iva" | "mutuo"
  | "anticipo_soci" | "ritenuta" | "abbonamento";

export type Flusso = {
  id: string;
  /** Data di cassa: se la scadenza e' passata coincide con oggi. */
  data: Date;
  /** Data di riferimento originale, utile per mostrare il ritardo. */
  dataOriginale: Date;
  label: string;
  /** Con segno: positivo = entrata, negativo = uscita. */
  importo: number;
  tipo: TipoFlusso;
  certo: boolean;
  /** Passata e non ancora avvenuta. */
  scaduta: boolean;
  /** Uscita che decidiamo noi: fuori dal pavimento dei vincoli. */
  discrezionale?: boolean;
  /** Dovuta solo se arrivano ricavi ancora da fatturare. */
  condizionato?: boolean;
  /** Entrata di una fattura gia' emessa, non una bozza. */
  emessa?: boolean;
  /** Entrata senza alcuna data: la data e' una stima a +30 giorni. */
  senzaData?: boolean;
  /** Data stimata a +30 giorni dall'invio, non indicata su Notion. */
  stimata?: boolean;
  /** IVA: quota dovuta sulle sole fatture gia' emesse. */
  ivaSoloEmesse?: number;
  /** IVA: parte certa e parte attesa, per le etichette delle pagine. */
  iva?: { trimestre: string; scadenzaStr: string; certo: number; atteso: number; credito: number; override: boolean };
  /** Riferimento alla fattura ricevuta, per i link dello scadenziario. */
  statusRicevuta?: string | null;
  /** Riferimento alla fattura emessa. */
  status?: string;
  nome?: string;
  /** Anticipo: socio e riga di origine. */
  socio?: string;
  anticipoId?: string;
};

/** Mesi generati in avanti per i costi ricorrenti: copre ogni orizzonte in uso. */
const MESI_ORIZZONTE = 24;

const r2 = (n: number) => Math.round(n * 100) / 100;

function d0(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Fatture che entrano nelle previsioni: emesse, piu' bozze con data di incasso. */
export function fattureInForecast(fatture: Fattura[]): Fattura[] {
  return fatture.filter((f) => f.status === "Inviata" || (f.status === "Da inviare" && f.dataIncassoAtteso != null));
}

function entrate(fatture: Fattura[], today: Date): Flusso[] {
  return fattureInForecast(fatture).map((f) => {
    const stimata = !f.dataIncassoAtteso;
    let d: Date;
    if (f.dataIncassoAtteso) d = new Date(f.dataIncassoAtteso + "T00:00:00");
    else {
      d = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(today);
      d.setDate(d.getDate() + 30);
    }
    d.setHours(0, 0, 0, 0);
    const data = d < today ? new Date(today) : d;
    return {
      id: `entrata-${f.id}`, data, dataOriginale: d, importo: f.incassoNetto, tipo: "entrata",
      label: f.status === "Da inviare" ? `⚑ ${f.nome}` : f.nome, nome: f.nome,
      certo: false, scaduta: d < today, emessa: f.status === "Inviata", status: f.status,
      stimata, senzaData: !f.dataIncassoAtteso && !f.dataInvio,
    } satisfies Flusso;
  });
}

function fornitori(ricevute: FatturaRicevuta[], today: Date): Flusso[] {
  const oggiStr = toDateStr(today);
  const out: Flusso[] = [];
  for (const f of ricevute) {
    // "Pagata" con data futura = addebito carta noto, non ancora uscito dal conto
    const pagataFutura = f.status === "Pagata" && f.dataPagamento != null && f.dataPagamento > oggiStr;
    const statoOk = f.status === "Ricevuta" || f.status === "In ritardo" || f.status === "Da ricevere" || pagataFutura;
    const dataRif = pagataFutura ? f.dataPagamento : f.scadenza;
    if (!statoOk || !dataRif) continue;
    const d = d0(new Date(dataRif));
    const scaduta = d < today;
    out.push({
      id: `fr-${f.id}`, data: scaduta ? new Date(today) : d, dataOriginale: d, importo: -f.importo,
      tipo: "uscita_fornitore", nome: f.nome, statusRicevuta: f.status,
      label: scaduta ? `${f.nome} ⚠ scaduta` : pagataFutura ? `💳 ${f.nome}` : f.status === "Da ricevere" ? `⚑ ${f.nome}` : f.nome,
      certo: f.status !== "Da ricevere", scaduta,
    });
  }
  return out;
}

function ritenute(ricevute: FatturaRicevuta[], today: Date): Flusso[] {
  const out: Flusso[] = [];
  for (const f of ricevute) {
    if (!f.importoRitenuta) continue;
    const dataBase = f.dataPagamento ? new Date(f.dataPagamento)
      : f.scadenza ? (new Date(f.scadenza) < today ? new Date(today) : new Date(f.scadenza))
      : null;
    if (!dataBase) continue;
    const scad = scadenzaRitenuta(dataBase);
    if (scad < today) continue;
    out.push({
      id: `ritenuta-${f.id}`, data: scad, dataOriginale: scad, importo: -f.importoRitenuta,
      tipo: "ritenuta", label: `Ritenuta ${f.nome}`, certo: true, scaduta: false,
    });
  }
  return out;
}

function iva(fatture: Fattura[], ricevute: FatturaRicevuta[], today: Date): Flusso[] {
  // certo = fatture gia' emesse, atteso = bozze in programma. Un debito fatto
  // solo di atteso non esiste se non fatturi. Il trimestre segue la data
  // fattura, non l'incasso.
  const perTrim = new Map<string, { certo: number; atteso: number }>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status !== "Da inviare") {
      const p = perTrim.get(f.trimestreIVA) ?? { certo: 0, atteso: 0 };
      perTrim.set(f.trimestreIVA, { ...p, certo: p.certo + f.iva22 });
    }
  }
  for (const f of fattureInForecast(fatture)) {
    if (f.status !== "Da inviare" || !f.trimestreIVA) continue;
    const p = perTrim.get(f.trimestreIVA) ?? { certo: 0, atteso: 0 };
    perTrim.set(f.trimestreIVA, { ...p, atteso: p.atteso + f.iva22 });
  }
  // Credito: solo fatture gia' ricevute e non in reverse charge.
  const perIVA = ricevute.filter((f) => f.status !== "Da ricevere" && !f.reverseCharge);
  const credito = calcolaIVACreditoPerTrimestre(perIVA, COSTI_RICORRENTI, today.getFullYear());
  const out: Flusso[] = [];
  for (const [trimestre, { certo, atteso }] of Array.from(perTrim)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [dd, mm, yy] = scadenzaStr.split("/").map(Number);
    const sc = new Date(yy, mm - 1, dd);
    sc.setHours(0, 0, 0, 0);
    if (sc < today) continue; // gia' versata
    const cred = r2(credito.get(trimestre) ?? 0);
    const override = trimestre in IVA_VERSAMENTI;
    const netta = IVA_VERSAMENTI[trimestre] ?? Math.max(0, r2(certo + atteso - cred));
    out.push({
      id: `iva-${trimestre}`, data: sc, dataOriginale: sc, importo: -netta, tipo: "iva",
      label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}`,
      certo: certo > 0, scaduta: false, condizionato: certo === 0 && atteso > 0,
      ivaSoloEmesse: IVA_VERSAMENTI[trimestre] ?? Math.max(0, r2(certo - cred)),
      iva: { trimestre, scadenzaStr, certo, atteso, credito: cred, override },
    });
  }
  return out;
}

function mutuo(today: Date): Flusso[] {
  const out: Flusso[] = [];
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata);
    d.setMonth(d.getMonth() + i);
    d.setHours(0, 0, 0, 0);
    if (d < today) continue;
    out.push({
      id: `mutuo-${i}`, data: d, dataOriginale: d, importo: -MUTUO.importoRata, tipo: "mutuo",
      label: `Rata mutuo (${i + 1}/${MUTUO.nRateRimanenti})`, certo: true, scaduta: false,
    });
  }
  return out;
}

function ricorrenti(today: Date): Flusso[] {
  const out: Flusso[] = [];
  for (const costo of COSTI_RICORRENTI) {
    const lordo = r2(costo.importoNetto * (1 + costo.aliquotaIVA));
    const freq = costo.frequenzaMesi ?? 1;
    for (let mo = 0; mo <= MESI_ORIZZONTE; mo++) {
      const anno = today.getFullYear() + Math.floor((today.getMonth() + mo) / 12);
      const mese = (today.getMonth() + mo) % 12;
      if (freq > 1 && costo.primaData) {
        const diff = (anno - costo.primaData.anno) * 12 + (mese - costo.primaData.mese);
        if (diff < 0 || diff % freq !== 0) continue;
      }
      const lastDay = new Date(anno, mese + 1, 0).getDate();
      const d = new Date(anno, mese, Math.min(costo.giornoAddebito, lastDay));
      d.setHours(0, 0, 0, 0);
      if (d < today) continue;
      out.push({
        id: `ricorrente-${costo.label}-${mo}`, data: d, dataOriginale: d, importo: -lordo,
        tipo: "abbonamento", label: costo.label, certo: true, scaduta: false,
      });
    }
  }
  return out;
}

/** Solo gli anticipi non ancora pagati sono flussi futuri. Uno con data passata
 *  resta in elenco come in ritardo: l'impegno non sparisce perche' e' scaduto. */
function anticipi(lista: AnticipoSocio[], today: Date): Flusso[] {
  return lista.filter((a) => a.stato !== "Pagato").map((a) => {
    const d = new Date(a.data + "T00:00:00");
    const scaduta = d < today;
    return {
      id: `anticipo-${a.id}`, data: scaduta ? new Date(today) : d, dataOriginale: d, importo: -a.importo,
      tipo: "anticipo_soci", label: `Anticipo ${a.socio}${scaduta ? " ⚠ in ritardo" : ""}`,
      certo: true, scaduta, discrezionale: true, socio: a.socio, anticipoId: a.id,
    } satisfies Flusso;
  });
}

/** Tutti i flussi futuri in ordine di data. Il filtro sull'orizzonte tocca al chiamante. */
export function calcolaFlussi(
  { fatture, ricevute, anticipiSoci, today }:
  { fatture: Fattura[]; ricevute: FatturaRicevuta[]; anticipiSoci: AnticipoSocio[]; today: Date },
): Flusso[] {
  const oggi = d0(today);
  return [
    ...fornitori(ricevute, oggi), ...ritenute(ricevute, oggi), ...iva(fatture, ricevute, oggi),
    ...mutuo(oggi), ...anticipi(anticipiSoci, oggi), ...ricorrenti(oggi), ...entrate(fatture, oggi),
  ].sort((a, b) => a.data.getTime() - b.data.getTime());
}

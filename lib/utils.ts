import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

/** "YYYY-MM-DD" dai componenti locali della data.
 *  Non usare toISOString(): converte in UTC e con TZ avanti (Europe/Rome)
 *  restituisce il giorno precedente, spostando trimestri e confronti. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Proiezione del saldo in due scenari, con arrotondamento uniforme.
 *  conservativo = solo le uscite, nessun incasso.
 *  ottimistico  = uscite più tutti gli incassi attesi, al 100% e nei tempi previsti.
 *  L'orizzonte temporale lo decide il chiamante filtrando entrate e uscite:
 *  90 giorni in cassa, fine anno in previsione, simulazione e snapshot. */
export function proiettaSaldo(saldoIniziale: number, entrateAttese: number, uscite: number) {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    conservativo: r(saldoIniziale - uscite),
    ottimistico: r(saldoIniziale + entrateAttese - uscite),
  };
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Un versamento che cade di sabato o domenica e' tempestivo se effettuato il
 *  primo giorno lavorativo successivo (art. 18 c.1 DLgs 241/97). Senza questa
 *  regola il tool mostra scadenze che non esistono: il 16/05/2026 era sabato. */
export function prossimoGiornoLavorativo(d: Date): Date {
  const r = new Date(d);
  const giorno = r.getDay();
  if (giorno === 6) r.setDate(r.getDate() + 2); // sabato → lunedi
  else if (giorno === 0) r.setDate(r.getDate() + 1); // domenica → lunedi
  return r;
}

export function scadenzaVersamentoIVA(trimestre: string): string {
  const [q, year] = trimestre.split(" ");
  const y = Number(year);
  // mese 0-based, anno: Q4 si versa a marzo dell'anno dopo
  const base: Record<string, [number, number, number]> = {
    Q1: [y, 4, 16],
    Q2: [y, 7, 20],  // 16/08 prorogato al 20 per Ferragosto (art. 37 c.11-bis DL 223/2006)
    Q3: [y, 10, 16],
    Q4: [y + 1, 2, 16],
  };
  const spec = base[q];
  if (!spec) return "—";
  const d = prossimoGiornoLavorativo(new Date(spec[0], spec[1], spec[2]));
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function calcolaTrimestre(dateStr: string): import("./types").TrimestreIVA | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}` as import("./types").TrimestreIVA;
}

export function periodoTrimestre(trimestre: string): string {
  const [q, year] = trimestre.split(" ");
  const periods: Record<string, string> = {
    Q1: `Gen–Mar ${year}`,
    Q2: `Apr–Giu ${year}`,
    Q3: `Lug–Set ${year}`,
    Q4: `Ott–Dic ${year}`,
  };
  return periods[q] ?? trimestre;
}

export function isUrgent(dateStr: string | null, daysThreshold = 15): boolean {
  if (!dateStr) return false;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= daysThreshold && diff >= 0;
}

/**
 * Calcola il saldo bancario dinamico partendo da SALDO_BASE:
 *  + fatture emesse incassate dopo la data di riconciliazione
 *  - fatture ricevute pagate dopo la data di riconciliazione (richiede "Data pagamento" su Notion)
 */
/** Restituisce il 15 del mese successivo alla data di pagamento fornitore.
 *  Gestisce la proroga di Ferragosto: se cade il 15/08 → slitta al 20/08. */
export function scadenzaRitenuta(dataRiferimento: Date): Date {
  const d = new Date(dataRiferimento);
  d.setMonth(d.getMonth() + 1);
  d.setDate(15);
  d.setHours(0, 0, 0, 0);
  // 15 agosto = Ferragosto: proroga al 20 agosto (circolare AE n. 20/E)
  if (d.getMonth() === 7 && d.getDate() === 15) {
    d.setDate(20);
  }
  return prossimoGiornoLavorativo(d);
}

/**
 * Calcola l'IVA credito su acquisti per trimestre.
 * Fonti: ricevute con campo IVA valorizzato + costi ricorrenti mensili (config).
 * Per le ricevute usa dataPagamento se presente, altrimenti scadenza.
 * Per i ricorrenti considera tutti i mesi dell'anno (il credito si matura nell'intero trimestre).
 */
export function calcolaIVACreditoPerTrimestre(
  ricevute: import("./types").FatturaRicevuta[],
  costiRicorrenti: Array<{
    importoNetto: number; aliquotaIVA: number; giornoAddebito: number;
    frequenzaMesi?: number; primaData?: { anno: number; mese: number };
  }>,
  anno: number
): Map<string, number> {
  const credito = new Map<string, number>();

  for (const f of ricevute) {
    if (f.importoIVA <= 0) continue;
    const dataRef = f.dataPagamento ?? f.scadenza ?? f.dataFattura;
    if (!dataRef) continue;
    const trim = calcolaTrimestre(dataRef);
    if (!trim) continue;
    credito.set(trim, (credito.get(trim) ?? 0) + f.importoIVA);
  }

  for (const costo of costiRicorrenti) {
    if (costo.aliquotaIVA <= 0) continue;
    const ivaRata = Math.round(costo.importoNetto * costo.aliquotaIVA * 100) / 100;
    const freq = costo.frequenzaMesi ?? 1;
    for (let m = 0; m <= 11; m++) {
      if (freq > 1 && costo.primaData) {
        const diff = (anno - costo.primaData.anno) * 12 + (m - costo.primaData.mese);
        if (diff < 0 || diff % freq !== 0) continue;
      }
      const lastDay = new Date(anno, m + 1, 0).getDate();
      const d = new Date(anno, m, Math.min(costo.giornoAddebito, lastDay));
      const trim = calcolaTrimestre(toDateStr(d));
      if (!trim) continue;
      credito.set(trim, (credito.get(trim) ?? 0) + ivaRata);
    }
  }

  return credito;
}

export function calcolaSaldoDinamico(
  fatture: import("./types").Fattura[],
  ricevute: import("./types").FatturaRicevuta[],
  baseImporto: number,
  baseData: string
): number {
  const oggi = toDateStr(new Date()); // solo movimenti già avvenuti

  const incassi = fatture
    .filter(f => f.status === "Pagata" && f.dataIncasso && f.dataIncasso > baseData && f.dataIncasso <= oggi)
    .reduce((s, f) => s + f.incassoNetto, 0);

  const pagamenti = ricevute
    .filter(f => f.status === "Pagata" && f.dataPagamento && f.dataPagamento > baseData && f.dataPagamento <= oggi)
    .reduce((s, f) => s + f.importo, 0);

  return Math.round((baseImporto + incassi - pagamenti) * 100) / 100;
}

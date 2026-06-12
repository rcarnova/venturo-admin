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

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function scadenzaVersamentoIVA(trimestre: string): string {
  const [q, year] = trimestre.split(" ");
  const y = Number(year);
  const dates: Record<string, string> = {
    Q1: `16/05/${y}`,
    Q2: `20/08/${y}`,
    Q3: `16/11/${y}`,
    Q4: `16/03/${y + 1}`,
  };
  return dates[q] ?? "—";
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
/** Restituisce il 15 del mese successivo alla data di pagamento fornitore */
export function scadenzaRitenuta(dataRiferimento: Date): Date {
  const d = new Date(dataRiferimento);
  d.setMonth(d.getMonth() + 1);
  d.setDate(15);
  d.setHours(0, 0, 0, 0);
  return d;
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
      const trim = calcolaTrimestre(d.toISOString().split("T")[0]);
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
  const incassi = fatture
    .filter(f => f.status === "Pagata" && f.dataIncasso && f.dataIncasso > baseData)
    .reduce((s, f) => s + f.incassoNetto, 0);

  const pagamenti = ricevute
    .filter(f => f.status === "Pagata" && f.dataPagamento && f.dataPagamento > baseData)
    .reduce((s, f) => s + f.importo, 0);

  return Math.round(baseImporto + incassi - pagamenti);
}

import type { Deal, Fattura } from "./types";
import { PIPE_GIORNI_ALLA_FATTURA } from "./config";

// Pesi della pipe per probabilita' — usati anche dalla pagina Pipeline.
export const PROB_WEIGHT: Record<string, number> = {
  "Alta 75-100%": 0.875,
  "Media 40-74%": 0.57,
  "Bassa 0-39%": 0.20,
};

export function pesoDeal(d: Deal): number {
  return d.probabilita ? (PROB_WEIGHT[d.probabilita] ?? 0.5) : 0.5;
}

// Anno in cui un deal aperto dovrebbe generare la prima fattura.
// Chiusura mancante o gia' passata = si assume che chiuda oggi.
export function annoFatturazioneDeal(d: Deal, today: Date): number {
  const chiusura = d.dataChiusura ? new Date(d.dataChiusura) : today;
  const base = chiusura < today ? today : chiusura;
  const fattura = new Date(base.getTime() + PIPE_GIORNI_ALLA_FATTURA * 86_400_000);
  return fattura.getFullYear();
}

export interface AvanzamentoTarget {
  anno: number;
  target: number;
  emesso: number;        // fatture Inviata / Pagata / In ritardo con data invio nell'anno
  programmato: number;   // fatture Da inviare con data invio nell'anno
  pipePesata: number;    // deal aperti che fatturano nell'anno, ponderati
  pipeLorda: number;     // stessi deal al valore pieno
  nDeal: number;
  certo: number;         // emesso + programmato
  previsto: number;      // certo + pipe pesata
  gapCerto: number;      // target - certo (>0 = manca)
  gapPrevisto: number;   // target - previsto (>0 = manca)
}

export function calcolaAvanzamento(
  anno: number,
  target: number,
  fatture: Fattura[],
  deals: Deal[],
  today: Date,
): AvanzamentoTarget {
  const nellAnno = (data: string | null) => data != null && data.slice(0, 4) === String(anno);

  let emesso = 0;
  let programmato = 0;
  for (const f of fatture) {
    if (!nellAnno(f.dataInvio)) continue;
    if (f.status === "Da inviare") programmato += f.importo;
    else emesso += f.importo;
  }

  const dealAnno = deals.filter((d) => d.status === "Open" && annoFatturazioneDeal(d, today) === anno);
  const pipePesata = dealAnno.reduce((s, d) => s + d.valore * pesoDeal(d), 0);
  const pipeLorda = dealAnno.reduce((s, d) => s + d.valore, 0);

  const certo = emesso + programmato;
  const previsto = certo + pipePesata;
  return {
    anno, target, emesso, programmato, pipePesata, pipeLorda, nDeal: dealAnno.length,
    certo, previsto, gapCerto: target - certo, gapPrevisto: target - previsto,
  };
}

// ─── Test di copertura degli anticipi ────────────────────────────────────────
// Un anticipo e' coperto se, dopo averlo pagato, il saldo resta positivo fino
// al primo versamento IVA successivo incluso: e' li' che si scopre se la cassa
// distribuita conteneva IVA. Si valuta per tranche, cioe' tutti i bonifici della
// stessa data insieme: l'esito non deve dipendere dal socio elencato per primo.
// Le tranche successive non contano, quelle precedenti si.
import type { Flusso } from "./flussi";
import { toDateStr } from "./utils";

export type EsitoCopertura = "coperto" | "solo_fido" | "non_coperto";

export type ScenarioCopertura = {
  esito: EsitoCopertura;
  saldoMinimo: number;
  dataMinimo: string;
  /** Importo massimo pagabile in questa data restando sopra zero, senza fido. */
  massimoSenzaFido: number;
};

export type CoperturaAnticipo = {
  id: string;
  /** Quota di ciascun socio nella tranche. */
  soci: { socio: string; importo: number }[];
  data: string;
  importo: number;
  inRitardo: boolean;
  /** Fino a quale data e' stato verificato. */
  verificatoFino: string;
  /** Incassi solo da fatture gia' emesse. */
  prudente: ScenarioCopertura;
  /** Incassi anche dalle bozze con data. */
  previsto: ScenarioCopertura;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function esito(minimo: number, fido: number): EsitoCopertura {
  if (minimo >= 0) return "coperto";
  return minimo + fido >= 0 ? "solo_fido" : "non_coperto";
}

/** Importo del flusso nello scenario prudente: niente bozze, ne' il loro incasso
 *  ne' la loro IVA, che senza fattura non esiste. */
function importoPrudente(f: Flusso): number {
  if (f.tipo === "entrata") return f.emessa ? f.importo : 0;
  if (f.tipo === "iva") return -(f.ivaSoloEmesse ?? -f.importo);
  return f.importo;
}

function valuta(
  saldo: number, flussi: Flusso[], valore: (f: Flusso) => number,
  da: number, fino: number, importo: number, fido: number,
): ScenarioCopertura {
  // A parita' di giorno gli incassi vengono prima delle uscite.
  const ordinati = [...flussi].sort((a, b) => a.data.getTime() - b.data.getTime() || valore(b) - valore(a));
  let running = saldo;
  let minimo = Infinity;
  let dataMinimo = toDateStr(new Date(da));
  for (const f of ordinati) {
    const t = f.data.getTime();
    if (t > fino) break;
    running = r2(running + valore(f));
    if (t >= da && running < minimo) { minimo = running; dataMinimo = toDateStr(f.data); }
  }
  if (minimo === Infinity) minimo = r2(running);
  return {
    esito: esito(minimo, fido), saldoMinimo: minimo, dataMinimo,
    massimoSenzaFido: Math.min(importo, Math.max(0, r2(importo + minimo))),
  };
}

/** @param flussi tutti i flussi futuri, anticipi inclusi. */
export function calcolaCopertura(saldo: number, flussi: Flusso[], fido: number): CoperturaAnticipo[] {
  const anticipi = flussi.filter((f) => f.tipo === "anticipo_soci");
  const date = Array.from(new Set(anticipi.map((a) => a.data.getTime())));
  return date.map((da) => {
    const tranche = anticipi.filter((a) => a.data.getTime() === da);
    const importo = r2(tranche.reduce((s, a) => s - a.importo, 0));
    const base = flussi.filter((f) => f.tipo !== "anticipo_soci" || f.data.getTime() <= da);
    const iva = flussi.find((f) => f.tipo === "iva" && f.data.getTime() >= da && f.importo < 0);
    const ultimo = flussi[flussi.length - 1];
    const fino = (iva ?? ultimo).data.getTime();
    return {
      id: `tranche-${da}`,
      soci: tranche.map((a) => ({ socio: a.socio ?? "", importo: -a.importo })),
      data: toDateStr(tranche[0].dataOriginale),
      importo,
      inRitardo: tranche.some((a) => a.scaduta),
      verificatoFino: toDateStr(new Date(fino)),
      prudente: valuta(saldo, base, importoPrudente, da, fino, importo, fido),
      previsto: valuta(saldo, base, (f) => f.importo, da, fino, importo, fido),
    };
  });
}

const PESO: Record<EsitoCopertura, number> = { coperto: 0, solo_fido: 1, non_coperto: 2 };

/** L'esito che comanda e' quello previsto: il prudente e' lo stress test. */
export function peggioreEsito(c: CoperturaAnticipo[]): EsitoCopertura {
  return c.reduce<EsitoCopertura>((w, x) => (PESO[x.previsto.esito] > PESO[w] ? x.previsto.esito : w), "coperto");
}

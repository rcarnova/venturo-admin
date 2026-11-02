import { DB, queryAll, mapAnticipo } from "./notion";
import type { AnticipoSocio } from "./types";

// Fonte unica: db Notion "Anticipo Soci". Una riga per socio e per bonifico.
// Se il db non e' configurato l'errore deve vedersi: un piano vuoto farebbe
// sembrare la cassa piu' libera di quanto sia.
export async function getAnticipiSoci(): Promise<AnticipoSocio[]> {
  if (!DB.ANTICIPI) throw new Error("NOTION_DB_ANTICIPI non configurato");
  const pagine = await queryAll(DB.ANTICIPI);
  const righe = pagine.map(mapAnticipo);
  const invalida = righe.find((a) => !a.data || !a.socio || !(a.importo > 0));
  if (invalida) throw new Error(`Anticipo Soci: riga incompleta (${invalida.id})`);
  return righe.sort((a, b) => a.data.localeCompare(b.data));
}

/** Totali per socio: pagato e ancora da pagare. */
export function riepilogoSoci(anticipi: AnticipoSocio[]) {
  const soci = Array.from(new Set(anticipi.map((a) => a.socio)));
  return soci.map((socio) => {
    const righe = anticipi.filter((a) => a.socio === socio);
    const somma = (stato: AnticipoSocio["stato"]) => righe.filter((a) => a.stato === stato).reduce((s, a) => s + a.importo, 0);
    return { socio, pagato: somma("Pagato"), pianificato: somma("Pianificato") };
  });
}

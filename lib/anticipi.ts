import { ANTICIPO_SOCI } from "./config";

export type AnticipoSoci = { data: Date; importo: number };

// Fonte unica: config.ts — modifica ANTICIPO_SOCI per aggiornare il piano
export async function getAnticipiSoci(): Promise<AnticipoSoci[]> {
  return [...ANTICIPO_SOCI];
}

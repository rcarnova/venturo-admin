import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  QueryDatabaseResponse,
} from "@notionhq/client/build/src/api-endpoints";
import type {
  Fattura,
  FatturaRicevuta,
  Fornitore,
  NotaSpese,
  Cliente,
  Deal,
} from "./types";
import { calcolaTrimestre } from "./utils";

// ─── Client singleton ────────────────────────────────────────────────────────
export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// ─── Database IDs ────────────────────────────────────────────────────────────
export const DB = {
  FATTURE: process.env.NOTION_DB_FATTURE!,
  FATTURE_RICEVUTE: process.env.NOTION_DB_FATTURE_RICEVUTE!,
  SCADENZE_IVA: process.env.NOTION_DB_SCADENZE_IVA!,
  FORNITORI: process.env.NOTION_DB_FORNITORI!,
  NOTE_SPESE: process.env.NOTION_DB_NOTE_SPESE!,
  CLIENTI: process.env.NOTION_DB_CLIENTI!,
  PIPELINE: process.env.NOTION_DB_PIPELINE!,
} as const;

// ─── Property helpers ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;

function getTitle(props: Props, key: string): string {
  return props[key]?.title?.[0]?.plain_text ?? "";
}
function getRichText(props: Props, key: string): string {
  return props[key]?.rich_text?.[0]?.plain_text ?? "";
}
function getNumber(props: Props, key: string): number {
  return props[key]?.number ?? 0;
}
function getSelect(props: Props, key: string): string | null {
  return props[key]?.select?.name ?? null;
}
function getCheckbox(props: Props, key: string): boolean {
  return props[key]?.checkbox ?? false;
}
function getUrl(props: Props, key: string): string | null {
  return props[key]?.url ?? null;
}
function getDate(props: Props, key: string): string | null {
  return props[key]?.date?.start ?? null;
}
function getRelationName(props: Props, key: string): string | null {
  // returns first relation ID (you can enrich with a follow-up fetch)
  return props[key]?.relation?.[0]?.id ?? null;
}
function getFormula(props: Props, key: string): number {
  return props[key]?.formula?.number ?? 0;
}
function getEmail(props: Props, key: string): string | null {
  return props[key]?.email ?? null;
}

// ─── Pages helper ─────────────────────────────────────────────────────────────
function getPages(res: QueryDatabaseResponse): PageObjectResponse[] {
  return res.results.filter(
    (r): r is PageObjectResponse => r.object === "page"
  );
}

// ─── Fetch all with pagination ───────────────────────────────────────────────
export async function queryAll(
  databaseId: string,
  filter?: object,
  sorts?: object[]
): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.databases.query({
      database_id: databaseId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filter: filter as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sorts: sorts as any,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...getPages(res));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────
export function mapFattura(page: PageObjectResponse): Fattura {
  const p = page.properties;
  const importo = getNumber(p, "Importo"); // imponibile (valore servizi)
  const dataInvio = getDate(p, "Data invio");
  const dataIncasso = getDate(p, "Incassata");
  const trimestreIVA = dataIncasso ? calcolaTrimestre(dataIncasso) : null;
  const baseIva = importo * 1.04; // imponibile + INPS rivalsa 4%
  const iva22 = Math.round(baseIva * 0.22 * 100) / 100;
  const ritenuta = Math.round(baseIva * 0.20 * 100) / 100;
  const incassoNetto = Math.round((baseIva + iva22 - ritenuta) * 100) / 100; // × 1.0608
  return {
    id: page.id,
    nome: getTitle(p, "Fattura"),
    importo,
    incassoNetto,
    iva22,
    ritenuta,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (getSelect(p, "Status fattura") as any) ?? "Da inviare",
    trimestreIVA,
    dataInvio,
    dataIncasso,
    fileFattura: getUrl(p, "File fattura"),
    cliente: getRelationName(p, "Clienti"),
    progetto: getRelationName(p, "Progetto"),
    createdAt: page.created_time,
  };
}

export function mapFornitore(page: PageObjectResponse): Fornitore {
  const p = page.properties;
  return {
    id: page.id,
    nome: getTitle(p, "Nome fornitore"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categoria: (getSelect(p, "Categoria") as any) ?? "Freelance",
    pIVA: getRichText(p, "P.IVA") || null,
    conIVA: getCheckbox(p, "Con IVA"),
    ritenuta: getCheckbox(p, "Ritenuta d'acconto"),
    percentualeRitenuta: getNumber(p, "% Ritenuta") || null,
    contatto: getRichText(p, "Contatto") || null,
    email: getEmail(p, "Email"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (getSelect(p, "Status") as any) ?? "Attivo",
    note: getRichText(p, "Note") || null,
  };
}


export function mapNotaSpese(page: PageObjectResponse): NotaSpese {
  const p = page.properties;
  return {
    id: page.id,
    descrizione: getTitle(p, "Descrizione"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    owner: (getSelect(p, "Owner") as any) ?? "Rosario",
    data: getDate(p, "Data"),
    importo: getNumber(p, "Importo"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categoria: (getSelect(p, "Categoria") as any) ?? "Altro",
    progetto: getRelationName(p, "Progetto"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    statusRimborso: (getSelect(p, "Status rimborso") as any) ?? "Da rimborsare",
    file: getUrl(p, "File"),
    protocolloLunedi: getCheckbox(p, "Protocollo lunedì"),
  };
}

export function mapCliente(page: PageObjectResponse): Cliente {
  const p = page.properties;
  return {
    id: page.id,
    nome: getTitle(p, "Nome Cliente"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (p["Status"] as any)?.status?.name ?? null,
    potenziale2026: getSelect(p, "Potenziale 2026"),
    prossimoContatto: getDate(p, "Prossimo contatto"),
    ultimoContatto: getDate(p, "Ultimo contatto"),
    noteNurturing: getRichText(p, "Note nurturing") || null,
  };
}

export function mapDeal(page: PageObjectResponse): Deal {
  const p = page.properties;
  return {
    id: page.id,
    opportunita: getTitle(p, "Opportunità"),
    status: (getSelect(p, "Status") as Deal["status"]) ?? "Open",
    valore: getNumber(p, "Valore (€)"),
    probabilita: getSelect(p, "Probabilità %") as Deal["probabilita"],
    fonte: getSelect(p, "Fonte") as Deal["fonte"],
    dataChiusura: getDate(p, "Data chiusura"),
    nomeContatto: getRichText(p, "Nome contatto") || null,
    ruoloContatto: getRichText(p, "Ruolo contatto") || null,
    clienteId: getRelationName(p, "Cliente collegato"),
    progettoId: getRelationName(p, "Progetto generato"),
  };
}

export function mapFatturaRicevuta(page: PageObjectResponse): FatturaRicevuta {
  const p = page.properties;
  return {
    id: page.id,
    nome: getTitle(p, "Fattura"),
    fornitore: getRelationName(p, "Fornitore"),
    dataFattura: getDate(p, "Data fattura"),
    scadenza: getDate(p, "Scadenza"),
    dataPagamento: getDate(p, "Data pagamento"),
    importo: getNumber(p, "Importo"),          // netto da pagare al fornitore
    importoIVA: getNumber(p, "IVA"),           // IVA detraibile (es. €148.72 per Gattuso)
    importoRitenuta: getNumber(p, "Ritenuta"), // importo ritenuta dalla fattura (es. €130)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (getSelect(p, "Status fattura") as any) ?? null,
    progetto: getRelationName(p, "Progetto"),
    fileFattura: getUrl(p, "File fattura"),
  };
}

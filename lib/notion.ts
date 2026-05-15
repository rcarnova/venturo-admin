import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  QueryDatabaseResponse,
} from "@notionhq/client/build/src/api-endpoints";
import type {
  Fattura,
  ScadenzaIVA,
  Fornitore,
  SpesaOperativa,
  NotaSpese,
} from "./types";

// ─── Client singleton ────────────────────────────────────────────────────────
export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// ─── Database IDs ────────────────────────────────────────────────────────────
export const DB = {
  FATTURE: process.env.NOTION_DB_FATTURE!,
  SCADENZE_IVA: process.env.NOTION_DB_SCADENZE_IVA!,
  FORNITORI: process.env.NOTION_DB_FORNITORI!,
  SPESE: process.env.NOTION_DB_SPESE!,
  NOTE_SPESE: process.env.NOTION_DB_NOTE_SPESE!,
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
  const importo = getNumber(p, "Importo");
  return {
    id: page.id,
    nome: getTitle(p, "Fattura"),
    importo,
    iva22: Math.round(importo * 0.22 * 100) / 100,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (getSelect(p, "Status") as any) ?? "Da inviare",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trimestreIVA: getSelect(p, "Trimestre IVA") as any,
    fileFattura: getUrl(p, "File fattura"),
    cliente: getRelationName(p, "Cliente"),
    progetto: getRelationName(p, "Progetto"),
    createdAt: page.created_time,
  };
}

export function mapScadenza(page: PageObjectResponse): ScadenzaIVA {
  const p = page.properties;
  return {
    id: page.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trimestre: getTitle(p, "Trimestre") as any,
    periodo: getRichText(p, "Periodo"),
    scadenzaVersamento: getDate(p, "Scadenza versamento") ?? "",
    totaleIVA: p["Totale IVA"]?.number ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (getSelect(p, "Status") as any) ?? "Da calcolare",
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

export function mapSpesa(page: PageObjectResponse): SpesaOperativa {
  const p = page.properties;
  const importo = getNumber(p, "Importo");
  const pctRitenuta = getNumber(p, "% Ritenuta");
  const nettoPagato = pctRitenuta
    ? Math.round((importo - (importo / 1.22) * (pctRitenuta / 100)) * 100) / 100
    : importo;

  return {
    id: page.id,
    nome: getTitle(p, "Spesa"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categoria: (getSelect(p, "Categoria") as any) ?? "Altro",
    data: getDate(p, "Data"),
    importo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    frequenza: getSelect(p, "Frequenza") as any,
    prossimoRinnovo: getDate(p, "Prossimo rinnovo"),
    fornitore: getRelationName(p, "Fornitore"),
    progetto: getRelationName(p, "Progetto"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pagamento: (getSelect(p, "Pagamento") as any) ?? "Da pagare",
    percentualeRitenuta: pctRitenuta || null,
    nettoPagato: getFormula(p, "Netto pagato") || nettoPagato,
    fileFattura: getUrl(p, "File fattura"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: (getSelect(p, "Status") as any) ?? "Attivo",
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

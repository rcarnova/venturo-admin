import { queryAll } from "./notion";
import { ANTICIPO_SOCI } from "./config";

export type AnticipoSoci = { data: Date; importo: number };

// reads from Notion if NOTION_DB_ANTICIPI is set; falls back to config.ts
export async function getAnticipiSoci(): Promise<AnticipoSoci[]> {
  const dbId = process.env.NOTION_DB_ANTICIPI;
  if (!dbId) return [...ANTICIPO_SOCI];

  try {
    const pages = await queryAll(dbId);
    if (pages.length === 0) return [...ANTICIPO_SOCI];

    const result: AnticipoSoci[] = [];
    for (const p of pages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const props = p.properties as Record<string, any>;
      const dateStr = props["Data"]?.date?.start as string | undefined;
      const importo = (props["Importo"]?.number ?? 0) as number;
      if (dateStr && importo > 0) {
        result.push({ data: new Date(dateStr + "T00:00:00"), importo });
      }
    }

    if (result.length === 0) return [...ANTICIPO_SOCI];
    return result.sort((a, b) => a.data.getTime() - b.data.getTime());
  } catch {
    return [...ANTICIPO_SOCI];
  }
}

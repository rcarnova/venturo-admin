import { NextResponse } from "next/server";
import { notion, DB, queryAll } from "@/lib/notion";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export async function GET() {
  const pages = await queryAll(DB.FATTURE);
  return NextResponse.json(
    pages
      .filter((p): p is PageObjectResponse => "properties" in p)
      .map((p) => {
        const props = p.properties as any;
        return {
          nome: props["Fattura"]?.title?.[0]?.plain_text ?? "—",
          importo: props["Importo"]?.number,
          ivaFormula: props["IVA (22%)"]?.formula?.number,
          ivaCalcolata: Math.round((props["Importo"]?.number ?? 0) * 0.22 * 100) / 100,
        };
      })
  );
}

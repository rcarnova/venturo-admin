import { NextResponse } from "next/server";
import { notion, DB, queryAll, mapFattura } from "@/lib/notion";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const pages = await queryAll(DB.FATTURE, undefined, [
      { property: "Fattura", direction: "descending" },
    ]);
    const all = pages.map(mapFattura);
    const fatture = status ? all.filter((f) => f.status === status) : all;
    return NextResponse.json(fatture);
  } catch (err) {
    console.error("[fatture] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...updates } = body;

    const properties: Record<string, unknown> = {};

    if (updates.status) {
      properties["Status fattura"] = { select: { name: updates.status } };
    }
    if (updates.trimestreIVA) {
      properties["Trimestre IVA"] = { select: { name: updates.trimestreIVA } };
    }
    if (updates.fileFattura !== undefined) {
      properties["File fattura"] = { url: updates.fileFattura };
    }

    await notion.pages.update({
      page_id: id,
      properties: properties as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[fatture] PATCH error:", err);
    return NextResponse.json({ error: "Errore aggiornamento" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { notion, DB, queryAll, mapScadenza } from "@/lib/notion";

export async function GET() {
  try {
    const pages = await queryAll(DB.SCADENZE_IVA);
    const scadenze = pages.map(mapScadenza);
    return NextResponse.json(scadenze);
  } catch (err) {
    console.error("[scadenze-iva] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, totaleIVA, status } = await req.json();
    const properties: Record<string, unknown> = {};

    if (totaleIVA !== undefined) {
      properties["Totale IVA"] = { number: totaleIVA };
    }
    if (status) {
      properties["Status"] = { select: { name: status } };
    }

    await notion.pages.update({
      page_id: id,
      properties: properties as Parameters<typeof notion.pages.update>[0]["properties"],
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[scadenze-iva] PATCH error:", err);
    return NextResponse.json({ error: "Errore aggiornamento" }, { status: 500 });
  }
}

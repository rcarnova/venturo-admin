import { NextResponse } from "next/server";
import { DB, queryAll, mapFatturaRicevuta } from "@/lib/notion";

export async function GET() {
  try {
    const pages = await queryAll(DB.FATTURE_RICEVUTE);
    return NextResponse.json(pages.map(mapFatturaRicevuta));
  } catch (err) {
    console.error("[fatture-ricevute] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { DB, queryAll, mapFornitore } from "@/lib/notion";

export async function GET() {
  try {
    const pages = await queryAll(DB.FORNITORI);
    return NextResponse.json(pages.map(mapFornitore));
  } catch (err) {
    console.error("[fornitori] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

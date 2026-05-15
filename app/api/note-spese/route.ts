import { NextResponse } from "next/server";
import { DB, queryAll, mapNotaSpese } from "@/lib/notion";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const filter = status
      ? { property: "Status rimborso", select: { equals: status } }
      : undefined;

    const pages = await queryAll(DB.NOTE_SPESE, filter);
    return NextResponse.json(pages.map(mapNotaSpese));
  } catch (err) {
    console.error("[note-spese] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

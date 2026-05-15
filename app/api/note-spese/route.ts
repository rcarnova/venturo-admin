import { NextResponse } from "next/server";
import { DB, queryAll, mapNotaSpese } from "@/lib/notion";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const pages = await queryAll(DB.NOTE_SPESE);
    const all = pages.map(mapNotaSpese);
    return NextResponse.json(status ? all.filter((n) => n.statusRimborso === status) : all);
  } catch (err) {
    console.error("[note-spese] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

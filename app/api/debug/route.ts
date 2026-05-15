import { NextResponse } from "next/server";
import { notion, DB, mapFatturaRicevuta, queryAll } from "@/lib/notion";

export async function GET() {
  const pages = await queryAll(DB.FATTURE_RICEVUTE);
  const fatture = pages.map(mapFatturaRicevuta);
  return NextResponse.json(fatture.map((f) => ({ nome: f.nome, status: f.status })));
}

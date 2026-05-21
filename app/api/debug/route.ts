import { NextResponse } from "next/server";
import { DB, queryAll, mapFattura } from "@/lib/notion";

export async function GET() {
  const pages = await queryAll(DB.FATTURE);
  return NextResponse.json(
    pages.map((p) => {
      const f = mapFattura(p);
      return {
        nome: f.nome,
        status: f.status,
        dataInvio: f.dataInvio,
        dataIncasso: f.dataIncasso,
        trimestreCalcolato: f.trimestreIVA,
      };
    })
  );
}

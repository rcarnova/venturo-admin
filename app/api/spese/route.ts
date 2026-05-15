import { NextResponse } from "next/server";
import { DB, queryAll, mapSpesa } from "@/lib/notion";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pagamento = searchParams.get("pagamento");

    const pages = await queryAll(DB.SPESE);
    const all = pages.map(mapSpesa);
    return NextResponse.json(pagamento ? all.filter((s) => s.pagamento === pagamento) : all);
  } catch (err) {
    console.error("[spese] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

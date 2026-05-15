import { NextResponse } from "next/server";
import { DB, queryAll, mapSpesa } from "@/lib/notion";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pagamento = searchParams.get("pagamento");

    const filter = pagamento
      ? { property: "Pagamento", select: { equals: pagamento } }
      : undefined;

    const pages = await queryAll(DB.SPESE, filter);
    return NextResponse.json(pages.map(mapSpesa));
  } catch (err) {
    console.error("[spese] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

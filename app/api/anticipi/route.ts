import { NextResponse } from "next/server";
import { notion, queryAll } from "@/lib/notion";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const dbId = process.env.NOTION_DB_ANTICIPI;

  if (!dbId) {
    return NextResponse.json(
      {
        error:
          "NOTION_DB_ANTICIPI non configurato. Crea un database Notion con proprietà Nome (titolo), Data (date) e Importo (number), poi aggiungi NOTION_DB_ANTICIPI=<id> alle variabili d'ambiente.",
      },
      { status: 400 }
    );
  }

  let body: { anticipi: { data: string; importo: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }

  const { anticipi } = body;
  if (!Array.isArray(anticipi)) {
    return NextResponse.json({ error: "anticipi deve essere un array" }, { status: 400 });
  }

  const valid = anticipi.filter(
    (a) => typeof a.data === "string" && a.data.length === 10 && Number(a.importo) > 0
  );

  // Archive all existing records
  const existing = await queryAll(dbId);
  await Promise.all(existing.map((p) => notion.pages.update({ page_id: p.id, archived: true })));

  // Create new records
  await Promise.all(
    valid.map((a, i) =>
      notion.pages.create({
        parent: { database_id: dbId },
        properties: {
          Nome: { title: [{ text: { content: `Anticipo ${i + 1}` } }] },
          Data: { date: { start: a.data } },
          Importo: { number: Number(a.importo) },
        },
      })
    )
  );

  return NextResponse.json({ ok: true, saved: valid.length });
}

import { NextResponse } from "next/server";
import { notion, DB } from "@/lib/notion";

export async function GET() {
  const res = await notion.databases.query({ database_id: DB.FATTURE, page_size: 1 });
  const page = res.results[0];
  if (!page || !("properties" in page)) return NextResponse.json({ error: "nessuna pagina" });
  return NextResponse.json(Object.keys(page.properties));
}

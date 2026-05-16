import { NextResponse } from "next/server";
import { notion, DB } from "@/lib/notion";

export async function GET() {
  const db = await notion.databases.retrieve({ database_id: DB.SCADENZE_IVA });
  return NextResponse.json(Object.fromEntries(Object.entries(db.properties).map(([k,v]) => [k, v.type])));
}

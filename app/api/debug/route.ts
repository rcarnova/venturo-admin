import { NextResponse } from "next/server";
import { notion, DB } from "@/lib/notion";

export async function GET() {
  const db = await notion.databases.retrieve({ database_id: DB.FATTURE });
  const types: Record<string, string> = {};
  for (const [name, prop] of Object.entries(db.properties)) {
    types[name] = prop.type;
  }
  return NextResponse.json(types);
}

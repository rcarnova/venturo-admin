import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Endpoint rimosso — le scadenze IVA sono ora calcolate direttamente dalle fatture." }, { status: 410 });
}

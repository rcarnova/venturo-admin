import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { SessionData, sessionOptions, USERS } from "@/lib/session";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  const normalized = username?.toLowerCase().trim();

  if (!USERS[normalized] || USERS[normalized] !== password) {
    return NextResponse.json({ error: "Credenziali non valide" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  session.user = { username: normalized };
  await session.save();

  return res;
}

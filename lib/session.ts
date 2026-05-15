import { SessionOptions } from "iron-session";

export interface SessionData {
  user?: { username: string };
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "venturo-admin-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 giorni
  },
};

export const USERS: Record<string, string> = {
  rosario: process.env.AUTH_ROSARIO!,
  massimo: process.env.AUTH_MASSIMO!,
};

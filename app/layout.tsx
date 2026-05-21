import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import { getIronSession } from "iron-session";
import { SessionData, sessionOptions } from "@/lib/session";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Venturo Admin",
  description: "Amministrazione Studio Miller / Venturo",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  const username = session.user?.username;

  return (
    <html lang="it">
      <body>
        <div className="neon-bar" />
        {username ? (
          <div className="app-shell">
            <Sidebar username={username} />
            <main className="main-content">
              {children}
            </main>
          </div>
        ) : (
          <>{children}</>
        )}
      </body>
    </html>
  );
}

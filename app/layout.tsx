import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import { getIronSession } from "iron-session";
import { SessionData, sessionOptions } from "@/lib/session";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Venturo Admin",
  description: "Amministrazione Studio Miller / Venturo",
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
          <div style={{ display: "flex", minHeight: "calc(100vh - 3px)" }}>
            <Sidebar username={username} />
            <main
              style={{
                flex: 1,
                padding: "2rem 2.5rem",
                overflowY: "auto",
                maxHeight: "calc(100vh - 3px)",
              }}
            >
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

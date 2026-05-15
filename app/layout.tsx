import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "Venturo Admin",
  description: "Amministrazione Studio Miller / Venturo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body>
        <div className="neon-bar" />
        <div style={{ display: "flex", minHeight: "calc(100vh - 3px)" }}>
          <Sidebar />
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
      </body>
    </html>
  );
}

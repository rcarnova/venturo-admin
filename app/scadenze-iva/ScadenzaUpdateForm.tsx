"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ScadenzaIVA, ScadenzaStatus } from "@/lib/types";

const STATUSES: ScadenzaStatus[] = ["Da calcolare", "Calcolata", "Versata", "In ritardo"];

export default function ScadenzaUpdateForm({
  scadenza,
  ivaCalcolata,
}: {
  scadenza: ScadenzaIVA;
  ivaCalcolata: number;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function aggiornaTotale() {
    setLoading(true);
    await fetch("/api/scadenze-iva", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: scadenza.id,
        totaleIVA: ivaCalcolata,
        status: "Calcolata",
      }),
    });
    router.refresh();
    setLoading(false);
  }

  async function updateStatus(status: ScadenzaStatus) {
    setLoading(true);
    await fetch("/api/scadenze-iva", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scadenza.id, status }),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <button
        onClick={aggiornaTotale}
        disabled={loading || ivaCalcolata === 0}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.65rem",
          padding: "0.3rem 0.75rem",
          background: "rgba(225,255,0,0.08)",
          border: "1px solid rgba(225,255,0,0.2)",
          borderRadius: "3px",
          color: "var(--accent)",
          cursor: "pointer",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          opacity: loading || ivaCalcolata === 0 ? 0.5 : 1,
        }}
      >
        {loading ? "..." : "Aggiorna totale IVA"}
      </button>

      <select
        value={scadenza.status}
        disabled={loading}
        onChange={(e) => updateStatus(e.target.value as ScadenzaStatus)}
        style={{
          background: "var(--surface-3)",
          border: "1px solid var(--border)",
          borderRadius: "3px",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.65rem",
          padding: "0.25rem 0.4rem",
          cursor: "pointer",
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)" }}>
        Aggiorna automaticamente il totale dalle fatture pagate con questo trimestre selezionato
      </span>
    </div>
  );
}

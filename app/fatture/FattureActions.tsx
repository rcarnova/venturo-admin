"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Fattura, FatturaStatus, TrimestreIVA } from "@/lib/types";

const STATUSES: FatturaStatus[] = ["Da inviare", "Inviata", "Pagata", "In ritardo"];
const TRIMESTRI: TrimestreIVA[] = ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026", "Q1 2027", "Q2 2027"];

export default function FattureActions({ fattura }: { fattura: Fattura }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function updateStatus(status: FatturaStatus) {
    setLoading(true);
    await fetch("/api/fatture", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: fattura.id, status }),
    });
    router.refresh();
    setLoading(false);
  }

  async function updateTrimestre(trimestreIVA: TrimestreIVA) {
    setLoading(true);
    await fetch("/api/fatture", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: fattura.id, trimestreIVA }),
    });
    router.refresh();
    setLoading(false);
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <select
        value={fattura.status}
        disabled={loading}
        onChange={(e) => updateStatus(e.target.value as FatturaStatus)}
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

      {fattura.status === "Pagata" && (
        <select
          value={fattura.trimestreIVA ?? ""}
          disabled={loading}
          onChange={(e) => updateTrimestre(e.target.value as TrimestreIVA)}
          style={{
            background: "var(--surface-3)",
            border: "1px solid rgba(225,255,0,0.2)",
            borderRadius: "3px",
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            padding: "0.25rem 0.4rem",
            cursor: "pointer",
          }}
        >
          <option value="">— Trimestre IVA</option>
          {TRIMESTRI.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

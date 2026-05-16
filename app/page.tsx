import Link from "next/link";
import { DB, queryAll, mapFattura, mapScadenza, mapFatturaRicevuta, mapFornitore, mapNotaSpese } from "@/lib/notion";
import { formatEuro, isUrgent } from "@/lib/utils";
import type { MondayAlert } from "@/lib/types";

async function getDashboardData() {
  const [fatturePages, scadenzePages, fattureRicevutePages, notePages, fornitori] =
    await Promise.all([
      queryAll(DB.FATTURE),
      queryAll(DB.SCADENZE_IVA),
      queryAll(DB.FATTURE_RICEVUTE),
      queryAll(DB.NOTE_SPESE),
      queryAll(DB.FORNITORI),
    ]);

  const fornitoriMap = new Map(fornitori.map((p) => [p.id, mapFornitore(p).nome]));
  const fatture = fatturePages.map(mapFattura);
  const scadenze = scadenzePages.map(mapScadenza);
  const fattureRicevute = fattureRicevutePages.map((p) => {
    const f = mapFatturaRicevuta(p);
    if (f.fornitore) f.fornitore = fornitoriMap.get(f.fornitore) ?? f.fornitore;
    return f;
  });
  const note = notePages.map(mapNotaSpese);

  const alerts: MondayAlert[] = [];

  const daInviare = fatture.filter((f) => f.status === "Da inviare");
  if (daInviare.length > 0)
    alerts.push({ tipo: "fattura_da_inviare", count: daInviare.length, urgente: false, label: "Fatture da inviare", href: "/fatture?status=Da+inviare" });

  const inRitardo = fatture.filter((f) => f.status === "In ritardo");
  if (inRitardo.length > 0)
    alerts.push({ tipo: "fattura_ritardo", count: inRitardo.length, urgente: true, label: "Fatture in ritardo", href: "/fatture?status=In+ritardo" });

  const daPagare = fattureRicevute.filter((f) => f.status === "Ricevuta");
  if (daPagare.length > 0)
    alerts.push({ tipo: "spesa_da_pagare", count: daPagare.length, urgente: false, label: "Fatture fornitori da pagare", href: "/fatture-ricevute?status=Ricevuta" });

  const daRimborsare = note.filter((n) => n.statusRimborso === "Da rimborsare");
  if (daRimborsare.length > 0)
    alerts.push({ tipo: "rimborso_da_liquidare", count: daRimborsare.length, urgente: false, label: "Rimborsi da liquidare", href: "/note-spese?status=Da+rimborsare" });

  const scadenzeImminenti = scadenze.filter(
    (s) => s.status === "Da calcolare" && isUrgent(s.scadenzaVersamento, 15)
  );
  if (scadenzeImminenti.length > 0)
    alerts.push({ tipo: "scadenza_iva", count: scadenzeImminenti.length, urgente: true, label: "Scadenze IVA imminenti", href: "/scadenze-iva" });

  // Stats
  const fattureInviate = fatture.filter((f) => f.status === "Inviata");
  const totaleDaIncassare = fattureInviate.reduce((s, f) => s + f.importo, 0);
  const totalePagato = fatture
    .filter((f) => f.status === "Pagata")
    .reduce((s, f) => s + f.importo, 0);
  const totaleSpese = fattureRicevute
    .filter((f) => f.status === "Pagata")
    .reduce((s, f) => s + f.importo, 0);
  const totaleRimborsi = note
    .filter((n) => n.statusRimborso === "Da rimborsare")
    .reduce((s, n) => s + n.importo, 0);
  const fornitoriDaPagare = fattureRicevute
    .filter((f) => f.status === "Ricevuta")
    .sort((a, b) => {
      if (!a.scadenza) return 1;
      if (!b.scadenza) return -1;
      return new Date(a.scadenza).getTime() - new Date(b.scadenza).getTime();
    });
  const totaleFornitori = fornitoriDaPagare.reduce((s, f) => s + f.importo, 0);

  return {
    alerts,
    stats: { totaleDaIncassare, totalePagato, totaleSpese, totaleRimborsi, totaleFornitori },
    scadenze,
    fornitoriDaPagare,
  };
}

export default async function DashboardPage() {
  const { alerts, stats, scadenze, fornitoriDaPagare } = await getDashboardData();
  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
          <h1
            style={{
              fontFamily: "var(--font-grotesk)",
              fontWeight: 700,
              fontSize: "1.6rem",
              letterSpacing: "-0.04em",
            }}
          >
            Dashboard
          </h1>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem",
              color: "var(--muted)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {today}
          </span>
        </div>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: "var(--muted)",
            marginTop: "4px",
          }}
        >
          Studio Miller / Venturo
        </p>
      </div>

      {/* Monday Protocol */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.65rem",
              color: "var(--accent)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            ◈ Protocollo Lunedì
          </span>
          <div
            style={{
              flex: 1,
              height: "1px",
              background: "var(--border)",
            }}
          />
          {alerts.length === 0 && (
            <span className="badge badge-success">Tutto ok</span>
          )}
          {alerts.length > 0 && (
            <span
              className="badge badge-warning"
              style={{ fontSize: "0.65rem" }}
            >
              {alerts.length} item{alerts.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {alerts.length === 0 ? (
          <div
            style={{
              padding: "1.5rem",
              background: "rgba(0, 200, 100, 0.04)",
              border: "1px solid rgba(0, 200, 100, 0.15)",
              borderRadius: "6px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "#00c864",
            }}
          >
            Nessuna azione pendente. Buon lavoro.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {alerts.map((alert) => (
              <Link
                key={alert.tipo}
                href={alert.href}
                style={{ textDecoration: "none" }}
              >
                <div className={`alert-card ${alert.urgente ? "urgent" : ""}`}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "1rem" }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "1rem",
                        color: alert.urgente ? "#ff4444" : "var(--accent)",
                        width: "1.5rem",
                        textAlign: "center",
                      }}
                    >
                      {alert.urgente ? "!" : "→"}
                    </span>
                    <div>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: "0.85rem",
                          color: "var(--text)",
                        }}
                      >
                        {alert.label}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span
                      className={`badge ${alert.urgente ? "badge-error" : "badge-warning"}`}
                    >
                      {alert.count}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.65rem",
                        color: "var(--muted)",
                      }}
                    >
                      →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Stats */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            color: "var(--muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "0.75rem",
          }}
        >
          Panoramica finanziaria
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <StatCard
            label="Da incassare"
            value={formatEuro(stats.totaleDaIncassare)}
            color="var(--accent)"
          />
          <StatCard
            label="Incassato"
            value={formatEuro(stats.totalePagato)}
            color="#00c864"
          />
          <StatCard
            label="Fornitori da pagare"
            value={formatEuro(stats.totaleFornitori)}
            color={stats.totaleFornitori > 0 ? "#ffb400" : "var(--muted)"}
          />
          <StatCard
            label="Fatture fornitori pagate"
            value={formatEuro(stats.totaleSpese)}
            color="var(--muted)"
          />
          <StatCard
            label="Rimborsi aperti"
            value={formatEuro(stats.totaleRimborsi)}
            color={stats.totaleRimborsi > 0 ? "#ffb400" : "var(--muted)"}
          />
        </div>
      </section>

      {/* Fatture fornitori da pagare */}
      {fornitoriDaPagare.length > 0 && (
        <section style={{ marginBottom: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Fatture fornitori da pagare
            </div>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            <Link href="/fatture-ricevute?status=Ricevuta" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--accent)", textDecoration: "none", letterSpacing: "0.04em" }}>
              Vedi tutte →
            </Link>
          </div>
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fattura</th>
                  <th>Fornitore</th>
                  <th>Importo</th>
                  <th>Scadenza</th>
                </tr>
              </thead>
              <tbody>
                {fornitoriDaPagare.map((f) => {
                  const urgente = isUrgent(f.scadenza, 15);
                  return (
                    <tr key={f.id}>
                      <td style={{ fontWeight: 500, fontSize: "0.85rem" }}>{f.nome}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>{f.fornitore ?? "—"}</td>
                      <td><span className="num">{formatEuro(f.importo)}</span></td>
                      <td>
                        <span className="num" style={{ fontSize: "0.75rem", color: urgente ? "#ffb400" : "var(--muted)", fontWeight: urgente ? 600 : 400 }}>
                          {f.scadenza ? new Date(f.scadenza).toLocaleDateString("it-IT") : "—"}
                          {urgente && " ⚠"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Scadenze IVA 2026 */}
      <section>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            color: "var(--muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "0.75rem",
          }}
        >
          Scadenze IVA 2026
        </div>
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Trimestre</th>
                <th>Periodo</th>
                <th>Scadenza</th>
                <th>Totale IVA</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {scadenze.map((s) => {
                const urgent = isUrgent(s.scadenzaVersamento, 15) && s.status === "Da calcolare";
                return (
                  <tr key={s.id} style={urgent ? { background: "rgba(255,60,60,0.03)" } : {}}>
                    <td>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 500 }}>
                        {s.trimestre}
                      </span>
                    </td>
                    <td style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>{s.periodo}</td>
                    <td>
                      <span className={`num ${urgent ? "text-red-400" : ""}`} style={{ fontSize: "0.8rem", color: urgent ? "#ff4444" : "var(--text)" }}>
                        {s.scadenzaVersamento
                          ? new Date(s.scadenzaVersamento).toLocaleDateString("it-IT")
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <span className="num" style={{ color: s.totaleIVA ? "var(--accent)" : "var(--muted-2)" }}>
                        {s.totaleIVA ? formatEuro(s.totaleIVA) : "—"}
                      </span>
                    </td>
                    <td>
                      <StatusBadgeInline status={s.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="stat-card">
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.6rem",
          color: "var(--muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </div>
      <div
        className="num"
        style={{ fontSize: "1.2rem", fontWeight: 600, color }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadgeInline({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Da calcolare": "badge-warning",
    Calcolata: "badge-accent",
    Versata: "badge-success",
    "In ritardo": "badge-error",
  };
  return <span className={`badge ${map[status] ?? "badge-neutral"}`}>{status}</span>;
}

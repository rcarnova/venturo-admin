import Link from "next/link";
import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapFornitore, mapNotaSpese, mapDeal } from "@/lib/notion";
import { formatEuro, isUrgent, scadenzaVersamentoIVA, periodoTrimestre, calcolaSaldoDinamico, calcolaIVACreditoPerTrimestre } from "@/lib/utils";
import { SALDO_BASE, COSTI_RICORRENTI } from "@/lib/config";
import type { MondayAlert, ScadenzaCalcolata } from "@/lib/types";

async function getDashboardData() {
  const [fatturePages, fattureRicevutePages, notePages, fornitori, pipelinePages] =
    await Promise.all([
      queryAll(DB.FATTURE),
      queryAll(DB.FATTURE_RICEVUTE),
      queryAll(DB.NOTE_SPESE),
      queryAll(DB.FORNITORI),
      queryAll(DB.PIPELINE),
    ]);

  const fornitoriMap = new Map(fornitori.map((p) => [p.id, mapFornitore(p).nome]));
  const fatture = fatturePages.map(mapFattura);
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

  const saldoAttuale = calcolaSaldoDinamico(fatture, fattureRicevute, SALDO_BASE.importo, SALDO_BASE.data);

  // Stats
  const fattureInviate = fatture.filter((f) => f.status === "Inviata");
  const totaleDaIncassare = fattureInviate.reduce((s, f) => s + f.incassoNetto, 0);
  const fattureInviateMesiExtra = fattureInviate.filter(f => {
    const anno = (f.dataInvio ?? f.createdAt).slice(0, 4);
    return anno !== String(ANNO_CORRENTE);
  }).length;
  const fatturePagate = fatture.filter((f) => f.status === "Pagata");
  const totalePagato = fatturePagate.reduce((s, f) => s + f.incassoNetto, 0);
  const totaleIVAPagata = fatturePagate.reduce((s, f) => s + f.iva22, 0);
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

  // Calcola scadenze IVA direttamente dalle fatture pagate
  const today = new Date();
  const ANNO_CORRENTE = today.getFullYear();
  const ivaPerTrimestre = new Map<string, number>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre.set(f.trimestreIVA, (ivaPerTrimestre.get(f.trimestreIVA) ?? 0) + f.iva22);
    }
  }
  const ivaCredito = calcolaIVACreditoPerTrimestre(fattureRicevute, COSTI_RICORRENTI, ANNO_CORRENTE);
  const scadenzeCalcolate: ScadenzaCalcolata[] = Array.from(ivaPerTrimestre.entries())
    .map(([trimestre, ivaDebito]) => {
      const scadenzaStr = scadenzaVersamentoIVA(trimestre);
      const [d, m, y] = scadenzaStr.split("/").map(Number);
      const scadenzaDate = new Date(y, m - 1, d);
      const versata = scadenzaDate < today;
      const diffDays = (scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      const creditoTrimestre = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
      const totaleIVA = Math.max(0, Math.round((ivaDebito - creditoTrimestre) * 100) / 100);
      return {
        trimestre: trimestre as ScadenzaCalcolata["trimestre"],
        periodo: periodoTrimestre(trimestre),
        scadenzaStr,
        scadenzaIso: scadenzaDate.toISOString(),
        totaleIVA,
        versata,
        urgent: !versata && diffDays <= 15,
      };
    })
    .sort((a, b) => new Date(a.scadenzaIso).getTime() - new Date(b.scadenzaIso).getTime());

  const prossimaScadenza = scadenzeCalcolate.find((s) => !s.versata) ?? null;
  const ivaProximaScadenza = prossimaScadenza?.totaleIVA ?? 0;

  const scadenzeImminenti = scadenzeCalcolate.filter((s) => s.urgent);
  if (scadenzeImminenti.length > 0)
    alerts.push({ tipo: "scadenza_iva", count: scadenzeImminenti.length, urgente: true, label: "Scadenze IVA imminenti", href: "/report-iva" });

  // Pipeline: venduto vs fatturato
  const deals = pipelinePages.map(mapDeal);
  const wonDeals = deals.filter((d) => d.status === "Won");
  const openDeals = deals.filter((d) => d.status === "Open");
  const totaleVenduto = wonDeals.reduce((s, d) => s + d.valore, 0);
  const totaleFatturato = fatture.reduce((s, f) => s + f.importo, 0);
  const totaleDaFatturare = Math.max(0, totaleVenduto - totaleFatturato);
  const totaleOpenPipeline = openDeals.reduce((s, d) => s + d.valore, 0);

  return {
    alerts,
    stats: { saldoAttuale, totaleDaIncassare, fattureInviateMesiExtra, totalePagato, totaleIVAPagata, totaleSpese, totaleRimborsi, totaleFornitori, ivaProximaScadenza },
    scadenzeCalcolate,
    fornitoriDaPagare,
    prossimaScadenza,
    pipeline: { totaleVenduto, totaleFatturato, totaleDaFatturare, totaleOpenPipeline, nWon: wonDeals.length, nOpen: openDeals.length },
  };
}

export default async function DashboardPage() {
  const { alerts, stats, scadenzeCalcolate, fornitoriDaPagare, prossimaScadenza, pipeline } = await getDashboardData();
  const ivaImplicita = Math.round(stats.totaleIVAPagata);
  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontFamily: "var(--font-grotesk)",
            fontWeight: 700,
            fontSize: "clamp(1.2rem, 5vw, 1.6rem)",
            letterSpacing: "-0.04em",
          }}
        >
          Dashboard
        </h1>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", marginTop: "4px" }}>
          {today}
        </p>
      </div>

      {/* Monday Protocol */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          {alerts.length === 0 && <span className="badge badge-success">Tutto ok</span>}
          {alerts.length > 0 && <span className="badge badge-warning" style={{ fontSize: "0.65rem" }}>{alerts.length} item{alerts.length > 1 ? "s" : ""}</span>}
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
          className="stat-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <StatCard
            label="Saldo in banca"
            value={formatEuro(stats.saldoAttuale)}
            color="var(--text)"
          />
          <StatCard
            label="Da incassare"
            value={formatEuro(stats.totaleDaIncassare)}
            color="var(--accent)"
            note={stats.fattureInviateMesiExtra > 0 ? `⚠ include ${stats.fattureInviateMesiExtra} fatt. anni prec.` : "lordo IVA · fatture inviate"}
          />
          <StatCard
            label="Incassato"
            value={formatEuro(stats.totalePagato)}
            color="#00c864"
            note={`di cui ${formatEuro(ivaImplicita)} IVA da versare`}
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
          {prossimaScadenza && (
            <StatCard
              label={`IVA ${prossimaScadenza.trimestre} · scad. ${prossimaScadenza.scadenzaStr}`}
              value={formatEuro(stats.ivaProximaScadenza)}
              color={isUrgent(prossimaScadenza.scadenzaIso, 30) ? "#ffb400" : "var(--accent)"}
            />
          )}
        </div>
      </section>

      {/* Pipeline */}
      <section style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Sales Pipeline
          </div>
          <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          <Link href="/pipeline" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--accent)", textDecoration: "none", letterSpacing: "0.04em" }}>
            Vedi pipeline →
          </Link>
        </div>
        <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <StatCard label="Venduto (Won)" value={formatEuro(pipeline.totaleVenduto)} color="var(--sage)" />
          <StatCard label="Fatturato" value={formatEuro(pipeline.totaleFatturato)} color="var(--text)" />
          <StatCard
            label="Da fatturare"
            value={formatEuro(pipeline.totaleDaFatturare)}
            color={pipeline.totaleDaFatturare > 0 ? "#ffb400" : "var(--sage)"}
          />
          <StatCard label="Pipeline aperta" value={formatEuro(pipeline.totaleOpenPipeline)} color="var(--accent)" />
        </div>
        {pipeline.totaleVenduto > 0 && (
          <div>
            <div style={{ height: "3px", background: "var(--surface-3)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, Math.round((pipeline.totaleFatturato / pipeline.totaleVenduto) * 100))}%`,
                background: pipeline.totaleDaFatturare <= 0 ? "var(--sage)" : "var(--accent)",
                borderRadius: "2px",
              }} />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
              {Math.min(100, Math.round((pipeline.totaleFatturato / pipeline.totaleVenduto) * 100))}% del venduto fatturato · {pipeline.nWon} deal vinti · {pipeline.nOpen} aperti
            </div>
          </div>
        )}
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
          <div className="table-scroll" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Fattura</th>
                  <th className="col-hide-mobile">Fornitore</th>
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
                      <td className="col-hide-mobile" style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>{f.fornitore ?? "—"}</td>
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

      {/* Scadenze IVA */}
      {scadenzeCalcolate.length > 0 && (
        <section>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Scadenze IVA
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {scadenzeCalcolate.map((s) => (
              <div
                key={s.trimestre}
                style={{
                  fontFamily: "var(--font-mono)",
                  padding: "0.5rem 0.85rem",
                  background: s.urgent ? "rgba(255,60,60,0.04)" : "var(--surface-2)",
                  border: `1px solid ${s.urgent ? "rgba(255,60,60,0.25)" : "var(--border)"}`,
                  borderRadius: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                }}
              >
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)" }}>{s.trimestre}</span>
                <span style={{ color: "var(--muted-2)" }}>·</span>
                <span style={{ fontSize: "0.7rem", color: s.urgent ? "#ff4444" : "var(--muted)" }}>{s.scadenzaStr}</span>
                <span style={{ fontSize: "0.68rem", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                  {formatEuro(s.totaleIVA)} netta
                </span>
                <StatusBadgeInline status={s.versata ? "Presunta" : "Da versare"} />
              </div>
            ))}
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.5rem" }}>
            IVA netta = debito meno credito acquisti. &quot;Versata&quot; è inferito dalla scadenza — aggiornare SALDO_BASE dopo ogni F24.
          </p>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
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
      {note && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>
          {note}
        </div>
      )}
    </div>
  );
}

function StatusBadgeInline({ status }: { status: string }) {
  const map: Record<string, string> = {
    Presunta: "badge-neutral",
    "Da versare": "badge-warning",
  };
  return <span className={`badge ${map[status] ?? "badge-neutral"}`}>{status}</span>;
}

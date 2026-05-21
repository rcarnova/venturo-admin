import { DB, queryAll, mapDeal } from "@/lib/notion";
import { formatEuro } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import type { Deal, DealStatus } from "@/lib/types";

export const revalidate = 0;

const PROB_WEIGHT: Record<string, number> = {
  "Alta 75-100%": 0.875,
  "Media 40-74%": 0.57,
  "Bassa 0-39%": 0.20,
};

const STATUS_ORDER: DealStatus[] = ["Open", "Freeze", "Won", "Lost"];

const STATUS_LABEL: Record<DealStatus, string> = {
  Open: "Aperti",
  Freeze: "In pausa",
  Won: "Chiusi vinti",
  Lost: "Chiusi persi",
};

const STATUS_BADGE: Record<DealStatus, string> = {
  Open: "badge-accent",
  Freeze: "badge-neutral",
  Won: "badge-success",
  Lost: "badge-error",
};

const PROB_BADGE: Record<string, string> = {
  "Alta 75-100%": "badge-sage",
  "Media 40-74%": "badge-warning",
  "Bassa 0-39%": "badge-error",
};

async function getData() {
  const pages = await queryAll(DB.PIPELINE);
  const deals = pages.map(mapDeal);

  const open = deals.filter((d) => d.status === "Open");
  const won = deals.filter((d) => d.status === "Won");
  const lost = deals.filter((d) => d.status === "Lost");
  const freeze = deals.filter((d) => d.status === "Freeze");

  const totaleOpen = open.reduce((s, d) => s + d.valore, 0);
  const totaleWon = won.reduce((s, d) => s + d.valore, 0);
  const totaleLost = lost.reduce((s, d) => s + d.valore, 0);

  const pipelinePesata = open.reduce((s, d) => {
    const w = d.probabilita ? (PROB_WEIGHT[d.probabilita] ?? 0.5) : 0.5;
    return s + d.valore * w;
  }, 0);

  const dealsChiusi = won.length + lost.length;
  const conversioneRate = dealsChiusi > 0 ? Math.round((won.length / dealsChiusi) * 100) : null;

  // Sort open/freeze by data chiusura asc (soonest first), Won/Lost by value desc
  const byChiusura = (a: Deal, b: Deal) => {
    if (!a.dataChiusura && !b.dataChiusura) return 0;
    if (!a.dataChiusura) return 1;
    if (!b.dataChiusura) return -1;
    return a.dataChiusura.localeCompare(b.dataChiusura);
  };
  const byValore = (a: Deal, b: Deal) => b.valore - a.valore;

  const grouped: Record<DealStatus, Deal[]> = {
    Open: [...open].sort(byChiusura),
    Freeze: [...freeze].sort(byChiusura),
    Won: [...won].sort(byValore),
    Lost: [...lost].sort(byValore),
  };

  return { deals, grouped, totaleOpen, totaleWon, totaleLost, pipelinePesata, conversioneRate, open, won, lost };
}

export default async function PipelinePage() {
  const { grouped, totaleOpen, totaleWon, totaleLost, pipelinePesata, conversioneRate, open, won, lost } = await getData();

  return (
    <div>
      <PageHeader
        title="Sales Pipeline"
        subtitle="Opportunità commerciali Studio Miller · Venturo"
      />

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <StatCard label="Pipeline aperta" value={formatEuro(totaleOpen)} color="var(--accent)" note={`${open.length} deal${open.length !== 1 ? "s" : ""}`} />
        <StatCard label="Pipeline pesata" value={formatEuro(Math.round(pipelinePesata))} color="var(--text)" note="ponderata per probabilità" />
        <StatCard label="Chiusi vinti" value={formatEuro(totaleWon)} color="var(--sage)" note={`${won.length} deal${won.length !== 1 ? "s" : ""}`} />
        <StatCard label="Chiusi persi" value={formatEuro(totaleLost)} color="var(--muted)" note={`${lost.length} deal${lost.length !== 1 ? "s" : ""}`} />
        {conversioneRate !== null && (
          <StatCard
            label="Tasso conversione"
            value={`${conversioneRate}%`}
            color={conversioneRate >= 60 ? "var(--sage)" : conversioneRate >= 40 ? "#ffb400" : "#ff4444"}
            note={`${won.length} vinti su ${won.length + lost.length} chiusi`}
          />
        )}
      </div>

      {/* Deal groups */}
      {STATUS_ORDER.map((status) => {
        const deals = grouped[status];
        if (deals.length === 0) return null;
        const totale = deals.reduce((s, d) => s + d.valore, 0);
        return (
          <section key={status} style={{ marginBottom: "2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {STATUS_LABEL[status]}
              </span>
              <span className={`badge ${STATUS_BADGE[status]}`}>{deals.length}</span>
              {totale > 0 && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted-2)", marginLeft: "auto" }}>
                  {formatEuro(totale)}
                </span>
              )}
            </div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Opportunità</th>
                      <th className="col-hide-mobile">Contatto</th>
                      <th>Valore</th>
                      <th className="col-hide-mobile">Probabilità</th>
                      <th className="col-hide-mobile">Chiusura</th>
                      <th className="col-hide-mobile">Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((d) => (
                      <DealRow key={d.id} deal={d} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  const chiusura = deal.dataChiusura
    ? new Date(deal.dataChiusura).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  const isScaduto = deal.dataChiusura && deal.status === "Open"
    ? new Date(deal.dataChiusura) < new Date()
    : false;

  return (
    <tr>
      <td style={{ fontWeight: 500, fontSize: "0.82rem" }}>
        {deal.opportunita}
      </td>
      <td className="col-hide-mobile" style={{ fontSize: "0.78rem", color: "var(--ink-300)" }}>
        {deal.nomeContatto ? (
          <>
            {deal.nomeContatto}
            {deal.ruoloContatto && (
              <span style={{ color: "var(--muted)", fontSize: "0.68rem", display: "block" }}>{deal.ruoloContatto}</span>
            )}
          </>
        ) : "—"}
      </td>
      <td>
        <span className="num" style={{ fontWeight: 600, color: deal.status === "Won" ? "var(--sage)" : deal.status === "Lost" ? "var(--muted)" : "var(--text)" }}>
          {formatEuro(deal.valore)}
        </span>
      </td>
      <td className="col-hide-mobile">
        {deal.probabilita ? (
          <span className={`badge ${PROB_BADGE[deal.probabilita] ?? "badge-neutral"}`} style={{ fontSize: "0.58rem" }}>
            {deal.probabilita === "Alta 75-100%" ? "Alta" : deal.probabilita === "Media 40-74%" ? "Media" : "Bassa"}
          </span>
        ) : "—"}
      </td>
      <td className="col-hide-mobile">
        {chiusura ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: isScaduto ? "#ff4444" : "var(--muted)" }}>
            {chiusura}
            {isScaduto && <span style={{ marginLeft: "0.3rem", fontSize: "0.6rem" }}>⚠</span>}
          </span>
        ) : "—"}
      </td>
      <td className="col-hide-mobile">
        {deal.fonte ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>
            {deal.fonte}
          </span>
        ) : "—"}
      </td>
    </tr>
  );
}

function StatCard({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <div className="stat-card">
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: "1.1rem", fontWeight: 600, color }}>
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

import { DB, queryAll, mapDeal, mapFattura } from "@/lib/notion";
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

type DealArricchito = Deal & { fatturato: number };

async function getData() {
  const [pipelinePages, fatturePages] = await Promise.all([
    queryAll(DB.PIPELINE),
    queryAll(DB.FATTURE),
  ]);

  const deals = pipelinePages.map(mapDeal);
  const fatture = fatturePages.map(mapFattura);

  // Mappa progettoId → totale fatturato (tutte le fatture non annullate)
  const fatturePerProgetto = new Map<string, number>();
  for (const f of fatture) {
    if (!f.progetto) continue;
    fatturePerProgetto.set(f.progetto, (fatturePerProgetto.get(f.progetto) ?? 0) + f.importo);
  }

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

  // Arricchisci i Won deals con il fatturato collegato
  const wonArricchiti: DealArricchito[] = won.map((d) => ({
    ...d,
    fatturato: d.progettoId ? (fatturePerProgetto.get(d.progettoId) ?? 0) : 0,
  }));

  const totaleFatturatoWon = wonArricchiti.reduce((s, d) => s + d.fatturato, 0);
  const totaleDaFatturare = totaleWon - totaleFatturatoWon;

  const dealsChiusi = won.length + lost.length;
  const conversioneRate = dealsChiusi > 0 ? Math.round((won.length / dealsChiusi) * 100) : null;

  const byChiusura = (a: Deal, b: Deal) => {
    if (!a.dataChiusura && !b.dataChiusura) return 0;
    if (!a.dataChiusura) return 1;
    if (!b.dataChiusura) return -1;
    return a.dataChiusura.localeCompare(b.dataChiusura);
  };
  const byValore = (a: DealArricchito | Deal, b: DealArricchito | Deal) => b.valore - a.valore;

  const grouped: Record<DealStatus, (Deal | DealArricchito)[]> = {
    Open: [...open].sort(byChiusura),
    Freeze: [...freeze].sort(byChiusura),
    Won: [...wonArricchiti].sort(byValore),
    Lost: [...lost].sort(byValore),
  };

  return {
    grouped,
    totaleOpen, totaleWon, totaleLost,
    pipelinePesata, conversioneRate,
    totaleFatturatoWon, totaleDaFatturare,
    open, won, lost,
  };
}

export default async function PipelinePage() {
  const {
    grouped,
    totaleOpen, totaleWon,
    pipelinePesata, conversioneRate,
    totaleFatturatoWon, totaleDaFatturare,
    open, won, lost,
  } = await getData();

  return (
    <div>
      <PageHeader
        title="Sales Pipeline"
        subtitle="Opportunità commerciali Studio Miller · Venturo"
      />

      {/* Pipeline aperta */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        Pipeline
      </div>
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem", marginBottom: "1.75rem" }}>
        <StatCard label="Pipeline aperta" value={formatEuro(totaleOpen)} color="var(--accent)" note={`${open.length} deal${open.length !== 1 ? "s" : ""}`} />
        <StatCard label="Pipeline pesata" value={formatEuro(Math.round(pipelinePesata))} color="var(--text)" note="ponderata per prob." />
        {conversioneRate !== null && (
          <StatCard
            label="Conversione"
            value={`${conversioneRate}%`}
            color={conversioneRate >= 60 ? "var(--sage)" : conversioneRate >= 40 ? "#ffb400" : "#ff4444"}
            note={`${won.length} vinti su ${won.length + lost.length} chiusi`}
          />
        )}
      </div>

      {/* Venduto vs Fatturato */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        Venduto vs Fatturato
      </div>
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <StatCard label="Venduto (Won)" value={formatEuro(totaleWon)} color="var(--sage)" note={`${won.length} deal chiusi`} />
        <StatCard label="Fatturato" value={formatEuro(totaleFatturatoWon)} color="var(--text)" note="fatture emesse collegate" />
        <StatCard
          label="Da fatturare"
          value={formatEuro(Math.max(0, totaleDaFatturare))}
          color={totaleDaFatturare > 0 ? "#ffb400" : "var(--sage)"}
          note={totaleDaFatturare <= 0 ? "tutto fatturato ✓" : "ancora da emettere"}
        />
      </div>

      {/* Barra progresso venduto/fatturato */}
      {totaleWon > 0 && (
        <FatturatoBar fatturato={totaleFatturatoWon} totale={totaleWon} />
      )}

      {/* Deal groups */}
      <div style={{ marginTop: "2rem" }}>
        {STATUS_ORDER.map((status) => {
          const deals = grouped[status];
          if (deals.length === 0) return null;
          const totale = deals.reduce((s, d) => s + d.valore, 0);
          const isWon = status === "Won";
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
                        {isWon && <th>Fatturazione</th>}
                        {!isWon && <th className="col-hide-mobile">Probabilità</th>}
                        <th className="col-hide-mobile">Chiusura</th>
                        <th className="col-hide-mobile">Fonte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deals.map((d) => (
                        <DealRow key={d.id} deal={d} showFatturazione={isWon} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FatturatoBar({ fatturato, totale }: { fatturato: number; totale: number }) {
  const pct = Math.min(100, Math.round((fatturato / totale) * 100));
  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ height: "4px", background: "var(--surface-3)", borderRadius: "2px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "var(--sage)" : "var(--accent)", borderRadius: "2px", transition: "width 0.3s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.3rem" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted)" }}>
          {pct}% fatturato
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted-2)" }}>
          {formatEuro(fatturato)} / {formatEuro(totale)}
        </span>
      </div>
    </div>
  );
}

function DealRow({ deal, showFatturazione }: { deal: Deal | DealArricchito; showFatturazione: boolean }) {
  const chiusura = deal.dataChiusura
    ? new Date(deal.dataChiusura).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  const isScaduto = deal.dataChiusura && deal.status === "Open"
    ? new Date(deal.dataChiusura) < new Date()
    : false;

  const fatturato = "fatturato" in deal ? deal.fatturato : undefined;
  const daFatturare = fatturato !== undefined ? deal.valore - fatturato : undefined;
  const collegato = deal.progettoId !== null;

  let fattBadgeClass = "badge-neutral";
  let fattLabel = "—";
  if (showFatturazione) {
    if (!collegato) {
      fattBadgeClass = "badge-neutral";
      fattLabel = "no progetto";
    } else if (fatturato === 0) {
      fattBadgeClass = "badge-warning";
      fattLabel = "da fatturare";
    } else if (daFatturare !== undefined && daFatturare <= 0) {
      fattBadgeClass = "badge-success";
      fattLabel = "fatturato";
    } else {
      fattBadgeClass = "badge-warning";
      fattLabel = "parziale";
    }
  }

  return (
    <tr>
      <td style={{ fontWeight: 500, fontSize: "0.82rem" }}>{deal.opportunita}</td>
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

      {showFatturazione ? (
        <td>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span className={`badge ${fattBadgeClass}`} style={{ fontSize: "0.58rem", alignSelf: "flex-start" }}>
              {fattLabel}
            </span>
            {fatturato !== undefined && fatturato > 0 && (
              <span className="num" style={{ fontSize: "0.68rem", color: "var(--sage)" }}>
                {formatEuro(fatturato)}
              </span>
            )}
            {daFatturare !== undefined && daFatturare > 0 && (
              <span className="num" style={{ fontSize: "0.65rem", color: "#ffb400" }}>
                −{formatEuro(daFatturare)} da emettere
              </span>
            )}
          </div>
        </td>
      ) : (
        <td className="col-hide-mobile">
          {deal.probabilita ? (
            <span className={`badge ${PROB_BADGE[deal.probabilita] ?? "badge-neutral"}`} style={{ fontSize: "0.58rem" }}>
              {deal.probabilita === "Alta 75-100%" ? "Alta" : deal.probabilita === "Media 40-74%" ? "Media" : "Bassa"}
            </span>
          ) : "—"}
        </td>
      )}

      <td className="col-hide-mobile">
        {chiusura ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: isScaduto ? "#ff4444" : "var(--muted)" }}>
            {chiusura}{isScaduto && " ⚠"}
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

import { DB, queryAll, mapCliente, mapFattura } from "@/lib/notion";
import { formatEuro, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

async function getData() {
  const [clientiPages, fatturePages] = await Promise.all([
    queryAll(DB.CLIENTI),
    queryAll(DB.FATTURE),
  ]);
  const clienti = clientiPages.map(mapCliente);
  const fatture = fatturePages.map(mapFattura);

  // Raggruppa fatture per cliente
  const fatturePerCliente = new Map<string, ReturnType<typeof mapFattura>[]>();
  for (const f of fatture) {
    if (!f.cliente) continue;
    const cid = f.cliente;
    if (!fatturePerCliente.has(cid)) fatturePerCliente.set(cid, []);
    fatturePerCliente.get(cid)!.push(f);
  }

  const clientiArricchiti = clienti
    .map((c) => {
      const fatt = fatturePerCliente.get(c.id) ?? [];
      const totaleFatturato = fatt.reduce((s, f) => s + f.importo, 0);
      const totaleIncassato = fatt.filter((f) => f.status === "Pagata").reduce((s, f) => s + f.importo, 0);
      const daIncassare = fatt.filter((f) => f.status === "Inviata").reduce((s, f) => s + f.importo, 0);
      const ultimaFattura = fatt.sort((a, b) => (b.dataInvio ?? "").localeCompare(a.dataInvio ?? ""))[0]?.dataInvio ?? null;
      return { ...c, fatt, totaleFatturato, totaleIncassato, daIncassare, ultimaFattura };
    })
    .sort((a, b) => b.totaleFatturato - a.totaleFatturato);

  return clientiArricchiti;
}

const STATUS_BADGE: Record<string, string> = {
  "Attivo": "badge-success",
  "Prospect": "badge-warning",
  "Inattivo": "badge-neutral",
};

export default async function ClientiPage() {
  const clienti = await getData();
  const totFatturato = clienti.reduce((s, c) => s + c.totaleFatturato, 0);
  const totDaIncassare = clienti.reduce((s, c) => s + c.daIncassare, 0);

  return (
    <div>
      <PageHeader
        title="Clienti"
        subtitle={`${clienti.length} clienti · ${clienti.filter((c) => c.fatt.length > 0).length} con fatture`}
      />

      {/* Summary */}
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
          Fatturato totale: <span className="num" style={{ color: "var(--text)" }}>{formatEuro(totFatturato)}</span>
        </div>
        {totDaIncassare > 0 && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
            Da incassare: <span className="num" style={{ color: "var(--accent)" }}>{formatEuro(totDaIncassare)}</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Status</th>
              <th>Fatturato</th>
              <th>Incassato</th>
              <th>Da incassare</th>
              <th>N. fatture</th>
              <th>Prossimo contatto</th>
            </tr>
          </thead>
          <tbody>
            {clienti.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                  Nessun cliente trovato
                </td>
              </tr>
            )}
            {clienti.map((c) => (
              <tr key={c.id}>
                <td>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{c.nome}</span>
                    {c.potenziale2026 && (
                      <span style={{ marginLeft: "0.5rem", fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted)", background: "var(--surface-3)", padding: "0.1rem 0.35rem", borderRadius: "2px", border: "1px solid var(--border)" }}>
                        {c.potenziale2026}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {c.status ? (
                    <span className={`badge ${STATUS_BADGE[c.status] ?? "badge-neutral"}`}>{c.status}</span>
                  ) : (
                    <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>—</span>
                  )}
                </td>
                <td>
                  <span className="num">{c.totaleFatturato > 0 ? formatEuro(c.totaleFatturato) : "—"}</span>
                </td>
                <td>
                  <span className="num" style={{ color: "#00c864" }}>
                    {c.totaleIncassato > 0 ? formatEuro(c.totaleIncassato) : "—"}
                  </span>
                </td>
                <td>
                  <span className="num" style={{ color: c.daIncassare > 0 ? "var(--accent)" : "var(--muted-2)" }}>
                    {c.daIncassare > 0 ? formatEuro(c.daIncassare) : "—"}
                  </span>
                </td>
                <td>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>
                    {c.fatt.length > 0 ? c.fatt.length : "—"}
                  </span>
                </td>
                <td>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: c.prossimoContatto ? "var(--accent)" : "var(--muted-2)" }}>
                    {c.prossimoContatto ? formatDate(c.prossimoContatto) : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

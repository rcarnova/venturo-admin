import { DB, queryAll, mapCliente, mapFornitore, mapFattura } from "@/lib/notion";
import { formatEuro, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabNav } from "@/components/shared/TabNav";
import { StatusBadge } from "@/components/shared/StatusBadge";

export const revalidate = 0;

async function getClienti() {
  const [clientiPages, fatturePages] = await Promise.all([
    queryAll(DB.CLIENTI),
    queryAll(DB.FATTURE),
  ]);
  const clienti = clientiPages.map(mapCliente);
  const fatture = fatturePages.map(mapFattura);

  const fatturePerCliente = new Map<string, ReturnType<typeof mapFattura>[]>();
  for (const f of fatture) {
    if (!f.cliente) continue;
    if (!fatturePerCliente.has(f.cliente)) fatturePerCliente.set(f.cliente, []);
    fatturePerCliente.get(f.cliente)!.push(f);
  }

  return clienti.map((c) => {
    const fatt = fatturePerCliente.get(c.id) ?? [];
    return {
      ...c,
      fatt,
      totaleFatturato: fatt.reduce((s, f) => s + f.importo, 0),
      totaleIncassato: fatt.filter(f => f.status === "Pagata").reduce((s, f) => s + f.importo, 0),
      daIncassare: fatt.filter(f => f.status === "Inviata").reduce((s, f) => s + f.importo, 0),
    };
  }).sort((a, b) => b.totaleFatturato - a.totaleFatturato);
}

async function getFornitori() {
  const pages = await queryAll(DB.FORNITORI);
  return pages.map(mapFornitore);
}

const STATUS_CLIENTE: Record<string, string> = {
  Attivo: "badge-success",
  Prospect: "badge-warning",
  Inattivo: "badge-neutral",
};

function Checkbox({ value }: { value: boolean }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: value ? "#00c864" : "var(--muted-2)" }}>
      {value ? "✓" : "×"}
    </span>
  );
}

export default async function AnagrafichePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab === "fornitori" ? "fornitori" : "clienti";

  const tabs = [
    { href: "/anagrafiche?tab=clienti", label: "Clienti", active: tab === "clienti" },
    { href: "/anagrafiche?tab=fornitori", label: "Fornitori", active: tab === "fornitori" },
  ];

  if (tab === "fornitori") {
    const fornitori = await getFornitori();
    return (
      <div>
        <PageHeader title="Anagrafiche" subtitle={`${fornitori.length} fornitori`} />
        <TabNav tabs={tabs} />
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>P.IVA</th>
                <th>Con IVA</th>
                <th>Ritenuta</th>
                <th>% Rit.</th>
                <th>Email</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {fornitori.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: "2rem" }}>
                    Nessun fornitore
                  </td>
                </tr>
              )}
              {fornitori.map((f) => (
                <tr key={f.id}>
                  <td><span style={{ fontWeight: 500 }}>{f.nome}</span></td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem" }}>
                      {f.categoria}
                    </span>
                  </td>
                  <td><span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{f.pIVA ?? "—"}</span></td>
                  <td><Checkbox value={f.conIVA} /></td>
                  <td><Checkbox value={f.ritenuta} /></td>
                  <td>
                    {f.percentualeRitenuta
                      ? <span className="num" style={{ color: "#ffb400" }}>{f.percentualeRitenuta}%</span>
                      : <span style={{ color: "var(--muted-2)" }}>—</span>}
                  </td>
                  <td>
                    {f.email
                      ? <a href={`mailto:${f.email}`} style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)", textDecoration: "none" }}>{f.email}</a>
                      : <span style={{ color: "var(--muted-2)" }}>—</span>}
                  </td>
                  <td><StatusBadge status={f.status} /></td>
                  <td>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={f.note ?? ""}>
                      {f.note ?? "—"}
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

  const clienti = await getClienti();
  const totFatturato = clienti.reduce((s, c) => s + c.totaleFatturato, 0);
  const totDaIncassare = clienti.reduce((s, c) => s + c.daIncassare, 0);

  return (
    <div>
      <PageHeader title="Anagrafiche" subtitle={`${clienti.length} clienti · ${clienti.filter(c => c.fatt.length > 0).length} con fatture`} />
      <TabNav tabs={tabs} />
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
                  {c.status
                    ? <span className={`badge ${STATUS_CLIENTE[c.status] ?? "badge-neutral"}`}>{c.status}</span>
                    : <span style={{ color: "var(--muted-2)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>—</span>}
                </td>
                <td><span className="num">{c.totaleFatturato > 0 ? formatEuro(c.totaleFatturato) : "—"}</span></td>
                <td><span className="num" style={{ color: "#00c864" }}>{c.totaleIncassato > 0 ? formatEuro(c.totaleIncassato) : "—"}</span></td>
                <td><span className="num" style={{ color: c.daIncassare > 0 ? "var(--accent)" : "var(--muted-2)" }}>{c.daIncassare > 0 ? formatEuro(c.daIncassare) : "—"}</span></td>
                <td><span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)" }}>{c.fatt.length > 0 ? c.fatt.length : "—"}</span></td>
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

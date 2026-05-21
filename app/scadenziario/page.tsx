import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese, mapCliente } from "@/lib/notion";
import { formatEuro, formatDate, scadenzaVersamentoIVA, periodoTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import Link from "next/link";

export const revalidate = 0;

type Evento = {
  id: string;
  data: string;
  dataDisplay: string;
  tipo: "incasso_atteso" | "pagamento_fornitore" | "iva" | "rimborso" | "contatto";
  label: string;
  importo: number | null;
  urgente: boolean;
  href: string;
};

async function getData() {
  const [fatturePages, ricevutePages, notePages, clientiPages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.NOTE_SPESE),
    queryAll(DB.CLIENTI),
  ]);
  const fatture = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);
  const note = notePages.map(mapNotaSpese);
  const clienti = clientiPages.map(mapCliente);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);

  const eventi: Evento[] = [];

  // Fatture ricevute con scadenza
  for (const f of ricevute) {
    if (f.status !== "Ricevuta" || !f.scadenza) continue;
    const d = new Date(f.scadenza);
    if (d > in90) continue;
    const diffDays = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    eventi.push({
      id: `fr-${f.id}`,
      data: f.scadenza,
      dataDisplay: formatDate(f.scadenza),
      tipo: "pagamento_fornitore",
      label: f.nome,
      importo: f.importo,
      urgente: diffDays <= 7,
      href: "/fatture-ricevute?status=Ricevuta",
    });
  }

  // Scadenze IVA calcolate
  const ivaPerTrimestre = new Map<string, number>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      ivaPerTrimestre.set(f.trimestreIVA, (ivaPerTrimestre.get(f.trimestreIVA) ?? 0) + f.iva22);
    }
  }
  for (const [trimestre, totaleIVA] of Array.from(ivaPerTrimestre)) {
    const scadenzaStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadenzaStr.split("/").map(Number);
    const scadenzaDate = new Date(y, m - 1, d);
    if (scadenzaDate < today || scadenzaDate > in90) continue;
    const diffDays = (scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    eventi.push({
      id: `iva-${trimestre}`,
      data: scadenzaDate.toISOString().split("T")[0],
      dataDisplay: scadenzaStr,
      tipo: "iva",
      label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}`,
      importo: totaleIVA,
      urgente: diffDays <= 15,
      href: "/scadenze-iva",
    });
  }

  // Note spese da rimborsare (senza data precisa — mostrate come "questa settimana")
  const totRimborsi = note.filter((n) => n.statusRimborso === "Da rimborsare").reduce((s, n) => s + n.importo, 0);
  if (totRimborsi > 0) {
    eventi.push({
      id: "rimborsi",
      data: today.toISOString().split("T")[0],
      dataDisplay: "Da liquidare",
      tipo: "rimborso",
      label: `${note.filter((n) => n.statusRimborso === "Da rimborsare").length} rimborsi spese`,
      importo: totRimborsi,
      urgente: false,
      href: "/note-spese?status=Da+rimborsare",
    });
  }

  // Prossimo contatto clienti
  for (const c of clienti) {
    if (!c.prossimoContatto) continue;
    const d = new Date(c.prossimoContatto);
    if (d < today || d > in90) continue;
    eventi.push({
      id: `contatto-${c.id}`,
      data: c.prossimoContatto,
      dataDisplay: formatDate(c.prossimoContatto),
      tipo: "contatto",
      label: `Follow-up: ${c.nome}`,
      importo: null,
      urgente: false,
      href: "/clienti",
    });
  }

  // Fatture emesse in attesa (da incassare) — senza data di incasso prevista
  const daIncassare = fatture.filter((f) => f.status === "Inviata");

  eventi.sort((a, b) => a.data.localeCompare(b.data));

  return { eventi, daIncassare };
}

const TIPO_CONFIG = {
  incasso_atteso: { color: "#00c864", label: "Incasso atteso", icon: "+" },
  pagamento_fornitore: { color: "#ffb400", label: "Pagamento fornitore", icon: "−" },
  iva: { color: "#ff4444", label: "Versamento IVA", icon: "−" },
  rimborso: { color: "#ffb400", label: "Rimborso", icon: "−" },
  contatto: { color: "var(--accent)", label: "Contatto", icon: "◷" },
};

export default async function ScadenziarioPage() {
  const { eventi, daIncassare } = await getData();

  return (
    <div>
      <PageHeader
        title="Scadenziario"
        subtitle="Prossimi 90 giorni"
      />

      {/* Fatture da incassare (senza data) */}
      {daIncassare.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Entrate attese — senza data di incasso prevista
          </div>
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
            <table className="admin-table">
              <thead>
                <tr><th>Fattura</th><th>Importo</th><th>Data invio</th></tr>
              </thead>
              <tbody>
                {daIncassare.map((f) => (
                  <tr key={f.id}>
                    <td style={{ fontWeight: 500, fontSize: "0.85rem" }}>{f.nome}</td>
                    <td><span className="num" style={{ color: "#00c864" }}>{formatEuro(f.importo)}</span></td>
                    <td><span className="num" style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{formatDate(f.dataInvio)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Timeline eventi */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Scadenze e impegni
      </div>

      {eventi.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--muted)", padding: "2rem 0" }}>
          Nessuna scadenza nei prossimi 90 giorni.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {eventi.map((e) => {
            const conf = TIPO_CONFIG[e.tipo];
            return (
              <Link key={e.id} href={e.href} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    background: e.urgente ? "rgba(255,60,60,0.03)" : "var(--surface-2)",
                    border: `1px solid ${e.urgente ? "rgba(255,60,60,0.25)" : "var(--border)"}`,
                    borderRadius: "5px",
                    padding: "0.7rem 1.25rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "1.25rem",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Data */}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: e.urgente ? "#ff4444" : "var(--muted)", minWidth: "6rem" }}>
                    {e.dataDisplay}
                    {e.urgente && " ⚠"}
                  </span>
                  {/* Icon */}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", color: conf.color, width: "1rem", textAlign: "center" }}>
                    {conf.icon}
                  </span>
                  {/* Label */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text)" }}>{e.label}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", marginTop: "1px" }}>{conf.label}</div>
                  </div>
                  {/* Importo */}
                  {e.importo !== null && (
                    <span className="num" style={{ color: conf.color, fontSize: "0.9rem", fontWeight: 600 }}>
                      {conf.icon === "+" ? "+" : "−"}{formatEuro(e.importo)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

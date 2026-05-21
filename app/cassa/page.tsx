import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import { formatEuro, scadenzaVersamentoIVA, periodoTrimestre } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";

export const revalidate = 0;

const SALDO_INIZIALE = 10_000;

type Flusso = {
  id: string;
  data: Date;
  dataStr: string;
  label: string;
  importo: number; // positivo = entrata, negativo = uscita
  tipo: "entrata" | "uscita_fornitore" | "iva";
  certo: boolean; // false = atteso ma non confermato
};

async function getData() {
  const [fatturePages, ricevutePages, notePages] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    queryAll(DB.NOTE_SPESE),
  ]);
  const fatture = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);
  const note = notePages.map(mapNotaSpese);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);

  const flussi: Flusso[] = [];

  // Entrate attese — fatture "Inviata" (certe ma senza data)
  const fattureAttese = fatture.filter((f) => f.status === "Inviata");
  const totaleAtteso = fattureAttese.reduce((s, f) => s + f.importo, 0);

  // Uscite certe — fatture ricevute con scadenza
  for (const f of ricevute) {
    if (f.status !== "Ricevuta" || !f.scadenza) continue;
    const d = new Date(f.scadenza);
    d.setHours(0, 0, 0, 0);
    flussi.push({
      id: `fr-${f.id}`,
      data: d,
      dataStr: d.toLocaleDateString("it-IT"),
      label: f.nome,
      importo: -f.importo,
      tipo: "uscita_fornitore",
      certo: true,
    });
  }

  // Uscite IVA — calcolate dalle fatture pagate
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
    scadenzaDate.setHours(0, 0, 0, 0);
    if (scadenzaDate < today) continue; // già versata
    flussi.push({
      id: `iva-${trimestre}`,
      data: scadenzaDate,
      dataStr: scadenzaStr,
      label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}`,
      importo: -totaleIVA,
      tipo: "iva",
      certo: true,
    });
  }

  // Rimborsi spese aperti
  const totRimborsi = note.filter((n) => n.statusRimborso === "Da rimborsare").reduce((s, n) => s + n.importo, 0);

  flussi.sort((a, b) => a.data.getTime() - b.data.getTime());

  // Proiezione: saldo nel tempo con sole uscite certe
  let saldoMinimo = SALDO_INIZIALE;
  let saldoMinPoint = SALDO_INIZIALE;
  for (const f of flussi.filter((x) => x.certo)) {
    saldoMinimo += f.importo;
    if (saldoMinimo < saldoMinPoint) saldoMinPoint = saldoMinimo;
  }

  // Proiezione ottimistica: uscite certe + tutte le entrate attese
  const saldoOttimistico = SALDO_INIZIALE + totaleAtteso + flussi.reduce((s, f) => s + f.importo, 0);

  // Flussi nei prossimi 90 giorni
  const flussi90 = flussi.filter((f) => f.data <= in90);

  return { flussi90, flussiTutti: flussi, fattureAttese, totaleAtteso, totRimborsi, saldoMinimo, saldoOttimistico };
}

export default async function CassaPage() {
  const { flussi90, fattureAttese, totaleAtteso, totRimborsi, saldoMinimo, saldoOttimistico } = await getData();

  const totUscite90 = flussi90.filter((f) => f.importo < 0).reduce((s, f) => s + Math.abs(f.importo), 0);
  const alertSaldo = saldoMinimo < 0;

  // Proiezione a step
  let runningBalance = SALDO_INIZIALE;
  const steps = flussi90.map((f) => {
    runningBalance += f.importo;
    return { ...f, saldo: runningBalance };
  });

  return (
    <div>
      <PageHeader
        title="Proiezione Cassa"
        subtitle="Prossimi 90 giorni · saldo iniziale €10.000"
      />

      {/* Cards di sintesi */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <SaldoCard label="Saldo attuale" value={formatEuro(SALDO_INIZIALE)} color="var(--text)" />
        <SaldoCard label="Entrate attese" value={formatEuro(totaleAtteso)} color="#00c864" note={`${fattureAttese.length} fatture inviata`} />
        <SaldoCard label="Uscite certe (90gg)" value={formatEuro(totUscite90)} color="#ffb400" />
        <SaldoCard
          label="Saldo minimo garantito"
          value={formatEuro(saldoMinimo)}
          color={alertSaldo ? "#ff4444" : "var(--text)"}
          note="senza incassare niente"
        />
        <SaldoCard
          label="Saldo ottimistico"
          value={formatEuro(saldoOttimistico)}
          color="var(--accent)"
          note="se incassi tutto"
        />
        {totRimborsi > 0 && (
          <SaldoCard label="Rimborsi aperti" value={formatEuro(totRimborsi)} color="#ffb400" note="non inclusi nelle uscite" />
        )}
      </div>

      {alertSaldo && (
        <div style={{ background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.3)", borderRadius: "6px", padding: "0.75rem 1.25rem", marginBottom: "1.5rem", fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "#ff4444" }}>
          ⚠ Attenzione: il saldo va in negativo anche senza considerare le entrate attese. Verifica la liquidità.
        </div>
      )}

      {/* Fatture attese */}
      {fattureAttese.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Entrate attese — non ancora incassate
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {fattureAttese.map((f) => (
              <span key={f.id} style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", background: "rgba(0,200,100,0.06)", border: "1px solid rgba(0,200,100,0.2)", borderRadius: "3px", padding: "0.25rem 0.6rem", color: "var(--text)" }}>
                {f.nome} <span style={{ color: "#00c864" }}>+{formatEuro(f.importo)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timeline uscite */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Timeline uscite nei prossimi 90 giorni
      </div>

      {steps.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--muted)", padding: "1rem 0" }}>
          Nessuna uscita prevista nei prossimi 90 giorni.
        </div>
      ) : (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrizione</th>
                <th>Tipo</th>
                <th>Importo</th>
                <th>Saldo proiettato</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>Oggi</td>
                <td style={{ fontSize: "0.82rem", fontWeight: 500 }}>Saldo iniziale</td>
                <td></td>
                <td></td>
                <td><span className="num" style={{ color: "var(--text)", fontWeight: 600 }}>{formatEuro(SALDO_INIZIALE)}</span></td>
              </tr>
              {steps.map((s) => (
                <tr key={s.id} style={s.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } : {}}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>{s.dataStr}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 500 }}>{s.label}</td>
                  <td>
                    <span className={`badge ${s.tipo === "iva" ? "badge-error" : "badge-warning"}`} style={{ fontSize: "0.58rem" }}>
                      {s.tipo === "iva" ? "IVA" : "Fornitore"}
                    </span>
                  </td>
                  <td><span className="num" style={{ color: "#ff4444" }}>{formatEuro(Math.abs(s.importo))}</span></td>
                  <td>
                    <span className="num" style={{ color: s.saldo < 0 ? "#ff4444" : s.saldo < 2000 ? "#ffb400" : "var(--text)", fontWeight: 600 }}>
                      {formatEuro(s.saldo)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SaldoCard({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
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

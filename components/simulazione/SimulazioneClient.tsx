"use client";

import { useState } from "react";
import { formatEuro } from "@/lib/utils";
import type { UscitaFissa } from "@/app/simulazione/page";

const MESI_FULL = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

type Anticipo = { id: string; dataStr: string; importo: number };

type Props = {
  saldoAttuale: number;
  daIncassare: number;
  daFatturareWon: number;
  usciteFisse: UscitaFissa[];
  anticipoDefault: { dataStr: string; importo: number }[];
  meseCorrente: number;
  fattore: number;
  semestre: number;
  fidoBancario: number;
};

let _nextId = 0;
function newId() { return `a-${_nextId++}`; }

export default function SimulazioneClient({
  saldoAttuale, daIncassare, daFatturareWon,
  usciteFisse, anticipoDefault, meseCorrente, fattore, fidoBancario,
}: Props) {
  const [anticipi, setAnticipi] = useState<Anticipo[]>(
    anticipoDefault.map(a => ({ ...a, id: newId() }))
  );

  function addAnticipo() {
    setAnticipi(prev => [...prev, { id: newId(), dataStr: "", importo: 0 }]);
  }

  function remove(id: string) {
    setAnticipi(prev => prev.filter(a => a.id !== id));
  }

  function update(id: string, field: "dataStr" | "importo", value: string | number) {
    setAnticipi(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
  }

  // ── Calcoli ────────────────────────────────────────────────────────────────
  const totaleAnticipi = anticipi.reduce((s, a) => s + (Number(a.importo) || 0), 0);
  const totaleUsciteFisse = usciteFisse.reduce((s, u) => s + u.importo, 0);

  const uscitePerMese = Array(12).fill(0) as number[];
  for (const u of usciteFisse) uscitePerMese[u.mese] += u.importo;
  for (const a of anticipi) {
    if (!a.dataStr || !a.importo) continue;
    const m = new Date(a.dataStr + "T00:00:00").getMonth();
    if (!isNaN(m)) uscitePerMese[m] += Number(a.importo);
  }

  let running = saldoAttuale;
  const righe = [];
  for (let m = meseCorrente; m <= 11; m++) {
    running -= uscitePerMese[m];
    const fisse = usciteFisse.filter(u => u.mese === m);
    const antMese = anticipi.filter(a => a.dataStr && new Date(a.dataStr + "T00:00:00").getMonth() === m && Number(a.importo) > 0);
    righe.push({
      mese: m,
      uscite: uscitePerMese[m],
      saldo: running,
      fisse,
      antMese,
    });
  }

  const saldoConservativo = righe[righe.length - 1]?.saldo ?? saldoAttuale;
  const saldoOttimistico  = saldoConservativo + daIncassare + daFatturareWon;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Inputs ── */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Piano anticipi soci
          </span>
          <button onClick={addAnticipo} style={btnStyle}>
            + Aggiungi rata
          </button>
        </div>

        {anticipi.length === 0 ? (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted)", padding: "1.25rem", background: "var(--surface-2)", borderRadius: "6px", border: "1px solid var(--border)", textAlign: "center" }}>
            Nessun anticipo pianificato — clicca &ldquo;+ Aggiungi rata&rdquo; per iniziare la simulazione.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {anticipi.map((a, idx) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.65rem 1rem", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--muted-2)", width: "1.2rem" }}>
                  #{idx + 1}
                </span>

                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Data</label>
                  <input
                    type="date"
                    value={a.dataStr}
                    onChange={e => update(a.id, "dataStr", e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Importo (€)</label>
                  <input
                    type="number"
                    value={a.importo || ""}
                    onChange={e => update(a.id, "importo", e.target.value)}
                    placeholder="0"
                    min={0}
                    step={500}
                    style={{ ...inputStyle, maxWidth: "130px" }}
                  />
                </div>

                {Number(a.importo) > 0 && (
                  <span className="num" style={{ fontSize: "0.82rem", color: Number(a.importo) > 0 ? "#ffb400" : "var(--muted)", fontWeight: 600, alignSelf: "flex-end", paddingBottom: "2px" }}>
                    −{formatEuro(Number(a.importo))}
                  </span>
                )}

                {a.dataStr && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", alignSelf: "flex-end", paddingBottom: "3px" }}>
                    {MESI_FULL[new Date(a.dataStr + "T00:00:00").getMonth()]}
                  </span>
                )}

                <button
                  onClick={() => remove(a.id)}
                  style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: "0.2rem 0.5rem", borderRadius: "3px", alignSelf: "flex-end" }}
                  title="Rimuovi"
                >
                  ✕
                </button>
              </div>
            ))}

            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "0.25rem", fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
              Totale anticipi:&ensp;
              <span className="num" style={{ color: "#ffb400", fontWeight: 600 }}>{formatEuro(totaleAnticipi)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <SaldoCard label="Saldo attuale" value={formatEuro(saldoAttuale)} color="var(--text)" />
        <SaldoCard label="Fido bancario" value={formatEuro(fidoBancario)} color="var(--muted)" note={`liquidità totale ${formatEuro(saldoAttuale + fidoBancario)}`} />
        <SaldoCard label="Anticipi simulati" value={formatEuro(totaleAnticipi)} color="#ffb400" note={`${anticipi.length} rata${anticipi.length !== 1 ? "e" : "a"}`} />
        <SaldoCard label="Altre uscite fisse" value={formatEuro(Math.round(totaleUsciteFisse))} color="var(--muted)" note="IVA + mutuo + fornitori + abbonamenti" />
        <SaldoCard
          label="Saldo conservativo dic"
          value={formatEuro(Math.round(saldoConservativo))}
          color={(saldoConservativo + fidoBancario) < 0 ? "#ff4444" : (saldoConservativo + fidoBancario) < 2000 ? "#ffb400" : "var(--text)"}
          note={`con fido: ${formatEuro(Math.round(saldoConservativo) + fidoBancario)}`}
        />
        <SaldoCard
          label="Saldo ottimistico dic"
          value={formatEuro(Math.round(saldoOttimistico))}
          color={(saldoOttimistico + fidoBancario) < 0 ? "#ff4444" : "var(--sage)"}
          note={`+ da incassare + Won ×${Math.round(fattore * 100)}%`}
        />
      </div>

      {/* ── Timeline ── */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        Proiezione mensile
      </div>
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Mese</th>
                <th className="col-hide-mobile">Uscite dettaglio</th>
                <th>Totale uscite</th>
                <th>Saldo fine mese</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--muted)" }}>Oggi</td>
                <td className="col-hide-mobile" />
                <td />
                <td><span className="num" style={{ fontWeight: 600 }}>{formatEuro(saldoAttuale)}</span></td>
              </tr>
              {righe.map(r => (
                <tr key={r.mese} style={r.saldo < 0 ? { background: "rgba(255,60,60,0.03)" } : {}}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600 }}>
                    {MESI_FULL[r.mese]}
                  </td>
                  <td className="col-hide-mobile">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {r.fisse.map((u, i) => (
                        <span key={i} className={`badge ${u.tipo === "iva" || u.tipo === "ritenuta" ? "badge-error" : u.tipo === "mutuo" || u.tipo === "abbonamento" ? "badge-neutral" : "badge-warning"}`} style={{ fontSize: "0.55rem" }}>
                          {u.tipo === "iva" ? u.label.split("—")[0].trim() : u.tipo === "ritenuta" ? "Ritenuta" : u.tipo === "mutuo" ? "Mutuo" : u.label} {formatEuro(u.importo)}
                        </span>
                      ))}
                      {r.antMese.map((a, i) => (
                        <span key={`ant-${i}`} className="badge badge-accent" style={{ fontSize: "0.55rem" }}>
                          Anticipo {formatEuro(Number(a.importo))}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {r.uscite > 0
                      ? <span className="num" style={{ color: "#ff4444" }}>−{formatEuro(Math.round(r.uscite))}</span>
                      : <span style={{ color: "var(--muted-2)", fontSize: "0.7rem" }}>—</span>
                    }
                  </td>
                  <td>
                    <span className="num" style={{ color: r.saldo < 0 ? "#ff4444" : r.saldo < 2000 ? "#ffb400" : "var(--text)", fontWeight: 600 }}>
                      {formatEuro(Math.round(r.saldo))}
                    </span>
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--sage)" }}>Dic (ottimistico)</td>
                <td className="col-hide-mobile" style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)" }}>
                  + fatture inviata {formatEuro(daIncassare)} + pipeline {formatEuro(daFatturareWon)}
                </td>
                <td />
                <td>
                  <span className="num" style={{ color: saldoOttimistico >= 0 ? "var(--sage)" : "#ff4444", fontWeight: 700 }}>
                    {formatEuro(Math.round(saldoOttimistico))}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.75rem",
  background: "var(--surface-3)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  padding: "0.35rem 0.6rem",
  color: "var(--text)",
  outline: "none",
  colorScheme: "dark",
};

const btnStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.65rem",
  color: "var(--accent)",
  background: "var(--accent-dim)",
  border: "1px solid var(--accent-border)",
  borderRadius: "4px",
  padding: "0.35rem 0.85rem",
  cursor: "pointer",
  letterSpacing: "0.04em",
};

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

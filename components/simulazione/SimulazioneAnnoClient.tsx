"use client";

// Simulazione di un anno futuro: anticipi soci e fatture ipotetiche sopra i
// flussi reali, e quanto fatturato nuovo serve per non scendere sotto una soglia.
// Lo scenario resta nel browser di chi lo prepara: non tocca Notion.
import { useEffect, useMemo, useState } from "react";
import { formatEuro, calcolaTrimestre, scadenzaVersamentoIVA } from "@/lib/utils";

const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

/** Incasso netto di un compenso: +4% rivalsa, +22% IVA, -20% ritenuta. */
const INCASSO = 1.0608;
/** IVA dovuta su un compenso: 22% di compenso + rivalsa. */
const IVA = 1.04 * 0.22;
const GIORNI_INCASSO = 30;

export type FlussoFisso = { d: string; i: number; l: string; t: string };

type Anticipo = { id: string; d: string; imp: number };
type FatturaIpotetica = { id: string; d: string; comp: number; nome: string };
type Evento = { d: string; i: number };

type Props = {
  anno: number;
  oggi: string;
  saldoIniziale: number;
  fido: number;
  flussiFissi: FlussoFisso[];
  anticipiDefault: { d: string; imp: number }[];
};

let seq = 0;
const nid = () => `s-${seq++}`;

function addGiorni(d: string, n: number): string {
  const x = new Date(d + "T00:00:00");
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function scadenzaIVA(dInvio: string): string {
  const t = calcolaTrimestre(dInvio);
  const s = t ? scadenzaVersamentoIVA(t) : "—";
  const [dd, mm, yy] = s.split("/");
  return `${yy}-${mm}-${dd}`;
}

function eventiFattura(d: string, comp: number): Evento[] {
  return [
    { d: addGiorni(d, GIORNI_INCASSO), i: comp * INCASSO },
    { d: scadenzaIVA(d), i: -comp * IVA },
  ];
}

/** Saldo progressivo; a parita' di giorno prima gli incassi. */
function percorso(saldo: number, eventi: Evento[]) {
  const ord = [...eventi].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : b.i - a.i));
  let s = saldo;
  return ord.map((e) => ({ d: e.d, i: e.i, s: (s += e.i) }));
}

export default function SimulazioneAnnoClient({ anno, oggi, saldoIniziale, fido, flussiFissi, anticipiDefault }: Props) {
  const chiave = `venturo-sim-${anno}`;
  const daNotion = () => anticipiDefault.map((a) => ({ id: nid(), d: a.d, imp: a.imp }));
  const [anticipi, setAnticipi] = useState<Anticipo[]>(daNotion);
  const [fatture, setFatture] = useState<FatturaIpotetica[]>([]);
  const [conFido, setConFido] = useState(false);
  const [caricato, setCaricato] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(chiave);
      if (raw) {
        const v = JSON.parse(raw);
        if (Array.isArray(v.anticipi)) setAnticipi(v.anticipi.map((a: Anticipo) => ({ ...a, id: nid() })));
        if (Array.isArray(v.fatture)) setFatture(v.fatture.map((f: FatturaIpotetica) => ({ ...f, id: nid() })));
        if (typeof v.conFido === "boolean") setConFido(v.conFido);
      }
    } catch { /* storage non disponibile: si parte dai dati di Notion */ }
    setCaricato(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!caricato) return;
    try { localStorage.setItem(chiave, JSON.stringify({ anticipi, fatture, conFido })); } catch { /* ignora */ }
  }, [caricato, chiave, anticipi, fatture, conFido]);

  const inizio = `${anno}-01-01`;
  const fine = `${anno}-12-31`;
  const soglia = conFido ? -fido : 0;

  const calcolo = useMemo(() => {
    const base: Evento[] = [
      ...flussiFissi.map((f) => ({ d: f.d, i: f.i })),
      ...anticipi.filter((a) => a.d && Number(a.imp) > 0).map((a) => ({ d: a.d, i: -Number(a.imp) })),
      ...fatture.filter((f) => f.d && Number(f.comp) > 0).flatMap((f) => eventiFattura(f.d, Number(f.comp))),
    ];

    // Fatturato da trovare: al primo giorno sotto soglia aggiungo la fattura
    // che, incassata quel giorno, lo riporta in soglia. Si ripete perche' ogni
    // fattura aggiunta porta con se' la sua IVA, che crea buchi piu' avanti.
    // Un buco gia' aperto al 01/01 viene dall'anno prima: si comincia a
    // controllare dal primo giorno in cui la cassa torna in soglia.
    const p0 = percorso(saldoIniziale, base);
    const ripresa = saldoIniziale >= soglia ? inizio : p0.find((r) => r.d >= inizio && r.s >= soglia)?.d ?? fine;
    const extra: { d: string; comp: number }[] = [];
    for (let k = 0; k < 400; k++) {
      const p = percorso(saldoIniziale, [...base, ...extra.flatMap((x) => eventiFattura(x.d, x.comp))]);
      const buco = p.find((r) => r.d >= ripresa && r.d <= fine && r.s < soglia - 0.5);
      if (!buco) break;
      extra.push({ d: addGiorni(buco.d, -GIORNI_INCASSO), comp: (soglia - buco.s) / INCASSO + 0.5 });
    }

    const p = percorso(saldoIniziale, base);
    const mesi = MESI.map((_, m) => {
      const pref = `${anno}-${String(m + 1).padStart(2, "0")}`;
      const r = p.filter((x) => x.d.startsWith(pref));
      const prima = p.filter((x) => x.d < `${pref}-01`);
      const apertura = prima.length ? prima[prima.length - 1].s : saldoIniziale;
      return {
        entrate: r.filter((x) => x.i > 0).reduce((s, x) => s + x.i, 0),
        uscite: r.filter((x) => x.i < 0).reduce((s, x) => s - x.i, 0),
        fineMese: r.length ? r[r.length - 1].s : apertura,
        minimo: Math.min(apertura, ...r.map((x) => x.s)),
      };
    });
    const nell = p.filter((x) => x.d >= inizio && x.d <= fine);
    const minimo = nell.reduce((m, x) => (x.s < m.s ? x : m), { d: inizio, s: saldoIniziale, i: 0 });
    const saldoFine = mesi[11].fineMese;

    const ivaDopo = Math.round(
      (flussiFissi.filter((f) => f.t === "iva" && f.d > fine).reduce((s, f) => s - f.i, 0)
        + fatture.filter((f) => f.d && Number(f.comp) > 0 && scadenzaIVA(f.d) > fine).reduce((s, f) => s + Number(f.comp) * IVA, 0)
        + extra.filter((x) => scadenzaIVA(x.d) > fine).reduce((s, x) => s + x.comp * IVA, 0)) * 100,
    ) / 100;

    const perMese = new Map<string, number>();
    for (const x of extra) perMese.set(x.d.slice(0, 7), (perMese.get(x.d.slice(0, 7)) ?? 0) + x.comp);
    let cum = 0;
    const daTrovare = Array.from(perMese.entries()).sort().map(([k, v]) => {
      cum += v;
      return { mese: k, importo: v, cumulato: cum, tardi: k < oggi.slice(0, 7) };
    });

    return { mesi, minimo, saldoFine, ivaDopo, daTrovare, totaleDaTrovare: cum, ripresa };
  }, [flussiFissi, anticipi, fatture, saldoIniziale, soglia, inizio, fine, anno, oggi]);

  const totAnticipi = anticipi.reduce((s, a) => s + (Number(a.imp) || 0), 0);
  const totFatture = fatture.reduce((s, f) => s + (Number(f.comp) || 0), 0);

  return (
    <div>
      <Sezione titolo="Anticipi soci" azione="+ Aggiungi rata" onAzione={() => setAnticipi((v) => [...v, { id: nid(), d: "", imp: 0 }])}>
        {anticipi.map((a) => (
          <Riga key={a.id} onRemove={() => setAnticipi((v) => v.filter((x) => x.id !== a.id))}>
            <Campo label="Data"><input type="date" value={a.d} onChange={(e) => setAnticipi((v) => v.map((x) => x.id === a.id ? { ...x, d: e.target.value } : x))} style={input} /></Campo>
            <Campo label="Totale soci (€)"><input type="number" min={0} step={500} value={a.imp || ""} onChange={(e) => setAnticipi((v) => v.map((x) => x.id === a.id ? { ...x, imp: Number(e.target.value) } : x))} style={{ ...input, maxWidth: 130 }} /></Campo>
          </Riga>
        ))}
        <Totale label="Totale anticipi" valore={totAnticipi} />
      </Sezione>

      <Sezione titolo="Fatture ipotetiche" azione="+ Aggiungi fattura" onAzione={() => setFatture((v) => [...v, { id: nid(), d: "", comp: 0, nome: "" }])}>
        {fatture.length === 0 && <Nota>Nessuna fattura ipotetica. Aggiungi i contratti che pensi di chiudere: incasso a 30 giorni, IVA al trimestre della data fattura.</Nota>}
        {fatture.map((f) => (
          <Riga key={f.id} onRemove={() => setFatture((v) => v.filter((x) => x.id !== f.id))}>
            <Campo label="Data fattura"><input type="date" value={f.d} onChange={(e) => setFatture((v) => v.map((x) => x.id === f.id ? { ...x, d: e.target.value } : x))} style={input} /></Campo>
            <Campo label="Compenso (€)"><input type="number" min={0} step={500} value={f.comp || ""} onChange={(e) => setFatture((v) => v.map((x) => x.id === f.id ? { ...x, comp: Number(e.target.value) } : x))} style={{ ...input, maxWidth: 130 }} /></Campo>
            <Campo label="Cliente / progetto"><input type="text" value={f.nome} onChange={(e) => setFatture((v) => v.map((x) => x.id === f.id ? { ...x, nome: e.target.value } : x))} style={{ ...input, minWidth: 180 }} /></Campo>
          </Riga>
        ))}
        {fatture.length > 0 && <Totale label="Compensi ipotetici" valore={totFatture} />}
      </Sezione>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1.75rem" }}>
        <span style={etichetta}>Soglia minima di cassa</span>
        <button onClick={() => setConFido(false)} style={{ ...bottone, ...(conFido ? {} : bottoneAttivo) }}>Senza fido (0 €)</button>
        <button onClick={() => setConFido(true)} style={{ ...bottone, ...(conFido ? bottoneAttivo : {}) }}>Con fido ({formatEuro(-fido)})</button>
        <button onClick={() => { setAnticipi(daNotion()); setFatture([]); }} style={{ ...bottone, marginLeft: "auto" }}>Ripristina da Notion</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
        <Card label={`Saldo al 01/01/${anno}`} valore={saldoIniziale} />
        <Card label="Punto più basso" valore={calcolo.minimo.s} nota={new Date(calcolo.minimo.d + "T00:00:00").toLocaleDateString("it-IT")} rosso={calcolo.minimo.s < soglia} />
        <Card label={`Saldo al 31/12/${anno}`} valore={calcolo.saldoFine} rosso={calcolo.saldoFine < soglia} />
        <Card label="IVA da versare dopo il 31/12" valore={calcolo.ivaDopo} nota="trimestre ott-dic, scade il 16/03" />
        <Card label="Fatturato da trovare" valore={calcolo.totaleDaTrovare} nota="compensi, oltre le fatture qui sopra" accento />
      </div>

      <div style={{ ...etichetta, marginBottom: "0.75rem" }}>Fatturato ancora da trovare, per mese di fatturazione</div>
      {calcolo.daTrovare.length === 0 ? (
        <Nota>Con questo scenario la cassa non scende mai sotto la soglia: non serve altro fatturato nel {anno}.</Nota>
      ) : (
        <Tabella intestazioni={["Fatturare entro", "Compensi", "Cumulato"]}>
          {calcolo.daTrovare.map((r) => (
            <tr key={r.mese}>
              <td style={cellaMese}>{MESI[Number(r.mese.slice(5, 7)) - 1]} {r.mese.slice(0, 4)}{r.tardi && <span style={{ color: "#ff4444" }}> · già passato</span>}</td>
              <td><span className="num" style={{ color: "var(--accent)", fontWeight: 600 }}>{formatEuro(Math.round(r.importo))}</span></td>
              <td><span className="num">{formatEuro(Math.round(r.cumulato))}</span></td>
            </tr>
          ))}
        </Tabella>
      )}
      <Nota>
        Calcolo: ogni euro di compenso incassa {INCASSO.toFixed(4).replace(".", ",")} € dopo {GIORNI_INCASSO} giorni e lascia {(IVA).toFixed(4).replace(".", ",")} € di IVA al
        trimestre. È il minimo per restare in soglia: non include l&apos;IVA che scade dopo il 31/12, l&apos;IRAP e un margine per gli imprevisti.
        {calcolo.ripresa > inizio && ` Lo scoperto di inizio anno, che arriva dall'anno prima, è escluso: il controllo parte dal ${new Date(calcolo.ripresa + "T00:00:00").toLocaleDateString("it-IT")}.`}
      </Nota>

      <div style={{ ...etichetta, margin: "2rem 0 0.75rem" }}>Mese per mese, con le fatture ipotetiche ma senza il fatturato da trovare</div>
      <Tabella intestazioni={["Mese", "Entrate", "Uscite", "Minimo nel mese", "Fine mese"]}>
        {calcolo.mesi.map((m, i) => (
          <tr key={i} style={m.minimo < soglia ? { background: "rgba(255,60,60,0.04)" } : {}}>
            <td style={cellaMese}>{MESI[i]}</td>
            <td><span className="num" style={{ color: "#00c864" }}>{m.entrate ? `+${formatEuro(Math.round(m.entrate))}` : "—"}</span></td>
            <td><span className="num" style={{ color: "#ff4444" }}>{m.uscite ? `−${formatEuro(Math.round(m.uscite))}` : "—"}</span></td>
            <td><span className="num" style={{ color: m.minimo < soglia ? "#ff4444" : "var(--muted)" }}>{formatEuro(Math.round(m.minimo))}</span></td>
            <td><span className="num" style={{ fontWeight: 600, color: m.fineMese < soglia ? "#ff4444" : "var(--text)" }}>{formatEuro(Math.round(m.fineMese))}</span></td>
          </tr>
        ))}
      </Tabella>
      <Nota>Lo scenario si salva solo in questo browser. Gli anticipi veri si decidono su Notion.</Nota>
    </div>
  );
}

// ─── UI ──────────────────────────────────────────────────────────────────────
const etichetta: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" };
const input: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.35rem 0.5rem", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "0.75rem" };
const bottone: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.62rem", letterSpacing: "0.05em", textTransform: "uppercase", background: "var(--surface-2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.4rem 0.75rem", cursor: "pointer" };
const bottoneAttivo: React.CSSProperties = { color: "var(--text)", borderColor: "var(--accent)" };
const cellaMese: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text)" };

function Sezione({ titolo, azione, onAzione, children }: { titolo: string; azione: string; onAzione: () => void; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={etichetta}>{titolo}</span>
        <button onClick={onAzione} style={bottone}>{azione}</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>{children}</div>
    </div>
  );
}

function Riga({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.6rem 1rem" }}>
      {children}
      <button onClick={onRemove} title="Rimuovi" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontFamily: "var(--font-mono)" }}>✕</button>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label style={{ ...etichetta, fontSize: "0.56rem" }}>{label}</label>
      {children}
    </div>
  );
}

function Totale({ label, valore }: { label: string; valore: number }) {
  return (
    <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--muted)" }}>
      {label}:&ensp;<span className="num" style={{ color: "#ffb400", fontWeight: 600 }}>{formatEuro(valore)}</span>
    </div>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--muted-2)", lineHeight: 1.6, margin: "0.5rem 0 1rem" }}>{children}</div>;
}

function Card({ label, valore, nota, rosso, accento }: { label: string; valore: number; nota?: string; rosso?: boolean; accento?: boolean }) {
  return (
    <div className="stat-card" style={accento ? { borderColor: "var(--accent-border)" } : {}}>
      <div style={{ ...etichetta, fontSize: "0.58rem", marginBottom: "0.45rem" }}>{label}</div>
      <div className="num" style={{ fontSize: "1.2rem", fontWeight: 700, color: rosso ? "#ff4444" : accento ? "var(--accent)" : "var(--text)" }}>{formatEuro(Math.round(valore))}</div>
      {nota && <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.56rem", color: "var(--muted-2)", marginTop: "0.3rem" }}>{nota}</div>}
    </div>
  );
}

function Tabella({ intestazioni, children }: { intestazioni: string[]; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden", marginBottom: "0.5rem" }}>
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr>{intestazioni.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

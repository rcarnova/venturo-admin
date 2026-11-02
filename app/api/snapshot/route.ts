import { NextRequest, NextResponse } from "next/server";
import { DB, queryAll, mapFattura, mapFatturaRicevuta } from "@/lib/notion";
import {
  calcolaSaldoDinamico, toDateStr, proiettaSaldo,
} from "@/lib/utils";
import { SALDO_BASE, FIDO_BANCARIO, IVA_VERSAMENTI } from "@/lib/config";
import { getAnticipiSoci, riepilogoSoci } from "@/lib/anticipi";
import { calcolaFlussi } from "@/lib/flussi";
import { calcolaCopertura } from "@/lib/copertura";

export const dynamic = "force-dynamic";

const ANNO = new Date().getFullYear();
const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

export async function GET(req: NextRequest) {
  const token =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("token");

  if (!token || token !== process.env.CLAUDE_API_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [fatturePages, ricevutePages, anticipiSoci] = await Promise.all([
    queryAll(DB.FATTURE),
    queryAll(DB.FATTURE_RICEVUTE),
    getAnticipiSoci(),
  ]);
  const fatture  = fatturePages.map(mapFattura);
  const ricevute = ricevutePages.map(mapFatturaRicevuta);

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const fineAnno = new Date(ANNO, 11, 31, 23, 59, 59);
  const meseCorrente = today.getMonth();
  const oggiStr  = toDateStr(today);

  // ── Saldo ─────────────────────────────────────────────────────────────────
  const saldoAttuale = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data, anticipiSoci);

  // ── Entrate ───────────────────────────────────────────────────────────────
  const incassatoYTD = fatture
    .filter(f => f.status === "Pagata" && f.dataIncasso && f.dataIncasso.startsWith(`${ANNO}`) && f.dataIncasso <= oggiStr)
    .reduce((s, f) => s + f.incassoNetto, 0);

  const flussi = calcolaFlussi({ fatture, ricevute, anticipiSoci, today });

  const entrateAttesaPerMese = Array(12).fill(0) as number[];
  const entrateDettaglio: { nome: string; status: string; importo: number; dataAttesa: string; stimata: boolean }[] = [];
  for (const f of flussi) {
    if (f.tipo !== "entrata") continue;
    entrateDettaglio.push({ nome: f.nome ?? f.label, status: f.status ?? "", importo: Math.round(f.importo * 100) / 100, dataAttesa: toDateStr(f.data), stimata: !!f.stimata });
    if (f.data.getFullYear() === ANNO) entrateAttesaPerMese[f.data.getMonth()] += f.importo;
  }
  const daIncassare = entrateAttesaPerMese.reduce((s, v) => s + v, 0);

  // ── Uscite ────────────────────────────────────────────────────────────────
  type Uscita = { data: string; mese: number; label: string; importo: number; tipo: string };
  const uscite: Uscita[] = [];
  const TIPI: Record<string, string> = { uscita_fornitore: "fornitore", iva: "iva", mutuo: "mutuo", anticipo_soci: "anticipo_soci", ritenuta: "ritenuta", abbonamento: "abbonamento" };
  for (const f of flussi) {
    if (!TIPI[f.tipo] || f.data > fineAnno) continue;
    const label = f.tipo === "mutuo" ? "Rata mutuo" : f.iva && IVA_VERSAMENTI[f.iva.trimestre] ? `${f.label} [confermato]` : f.label;
    uscite.push({ data: toDateStr(f.data), mese: f.data.getMonth(), label, importo: -f.importo, tipo: TIPI[f.tipo] });
  }

  uscite.sort((a, b) => a.data.localeCompare(b.data));

  const totaleUscite = uscite.reduce((s, u) => s + u.importo, 0);
  const { conservativo: saldoConservativo, ottimistico: saldoOttimistico } =
    proiettaSaldo(saldoAttuale, daIncassare, totaleUscite);

  // ── Forecast mensile ──────────────────────────────────────────────────────
  const uscitePerMese = Array(12).fill(0) as number[];
  for (const u of uscite) uscitePerMese[u.mese] += u.importo;

  const forecastMensile: { mese: string; entrate: number; uscite: number; netto: number; saldoFineMese: number }[] = [];
  let running = saldoAttuale;
  for (let m = meseCorrente; m <= 11; m++) {
    running += entrateAttesaPerMese[m];
    running -= uscitePerMese[m];
    forecastMensile.push({
      mese: MESI[m],
      entrate: Math.round(entrateAttesaPerMese[m] * 100) / 100,
      uscite: Math.round(uscitePerMese[m] * 100) / 100,
      netto: Math.round((entrateAttesaPerMese[m] - uscitePerMese[m]) * 100) / 100,
      saldoFineMese: Math.round(running * 100) / 100,
    });
  }

  // ── Riepilogo fatture ─────────────────────────────────────────────────────
  const fattureRiepilogo = {
    pagate: { count: 0, totale: 0 },
    inviate: { count: 0, totale: 0 },
    daInviare: { count: 0, totale: 0 },
  };
  for (const f of fatture) {
    if (f.status === "Pagata") { fattureRiepilogo.pagate.count++; fattureRiepilogo.pagate.totale += f.importo; }
    else if (f.status === "Inviata") { fattureRiepilogo.inviate.count++; fattureRiepilogo.inviate.totale += f.importo; }
    else if (f.status === "Da inviare") { fattureRiepilogo.daInviare.count++; fattureRiepilogo.daInviare.totale += f.importo; }
  }

  // ── Risposta ──────────────────────────────────────────────────────────────
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    anno: ANNO,
    anticipi: {
      soci: riepilogoSoci(anticipiSoci),
      copertura: calcolaCopertura(saldoAttuale, flussi, FIDO_BANCARIO),
    },
    saldo: {
      base: SALDO_BASE,
      attuale: saldoAttuale,
      fidoBancario: FIDO_BANCARIO,
      conservativo: Math.round(saldoConservativo * 100) / 100,
      ottimistico: Math.round(saldoOttimistico * 100) / 100,
      ottimisticoConFido: Math.round((saldoOttimistico + FIDO_BANCARIO) * 100) / 100,
    },
    entrate: {
      incassatoYTD: Math.round(incassatoYTD * 100) / 100,
      daIncassare: Math.round(daIncassare * 100) / 100,
      fatture: entrateDettaglio.sort((a, b) => a.dataAttesa.localeCompare(b.dataAttesa)),
    },
    uscite: {
      totale: Math.round(totaleUscite * 100) / 100,
      breakdown: {
        iva: Math.round(uscite.filter(u => u.tipo === "iva").reduce((s, u) => s + u.importo, 0) * 100) / 100,
        mutuo: Math.round(uscite.filter(u => u.tipo === "mutuo").reduce((s, u) => s + u.importo, 0) * 100) / 100,
        fornitori: Math.round(uscite.filter(u => u.tipo === "fornitore").reduce((s, u) => s + u.importo, 0) * 100) / 100,
        anticipiSoci: Math.round(uscite.filter(u => u.tipo === "anticipo_soci").reduce((s, u) => s + u.importo, 0) * 100) / 100,
        ritenute: Math.round(uscite.filter(u => u.tipo === "ritenuta").reduce((s, u) => s + u.importo, 0) * 100) / 100,
        abbonamenti: Math.round(uscite.filter(u => u.tipo === "abbonamento").reduce((s, u) => s + u.importo, 0) * 100) / 100,
      },
      dettaglio: uscite,
    },
    forecastMensile,
    fatture: fattureRiepilogo,
    fornitori: ricevute
      .filter(f => f.status === "Ricevuta" || f.status === "In ritardo" || f.status === "Da ricevere")
      .map(f => ({ nome: f.nome, importo: f.importo, scadenza: f.scadenza, status: f.status }))
      .sort((a, b) => (a.scadenza ?? "").localeCompare(b.scadenza ?? "")),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { DB, queryAll, mapFattura, mapFatturaRicevuta } from "@/lib/notion";
import {
  calcolaSaldoDinamico, scadenzaVersamentoIVA, periodoTrimestre,
  calcolaIVACreditoPerTrimestre, calcolaTrimestre, scadenzaRitenuta,
} from "@/lib/utils";
import { SALDO_BASE, MUTUO, COSTI_RICORRENTI, FIDO_BANCARIO, IVA_VERSAMENTI } from "@/lib/config";
import { getAnticipiSoci } from "@/lib/anticipi";

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
  const oggiStr  = today.toISOString().split("T")[0];

  // ── Saldo ─────────────────────────────────────────────────────────────────
  const saldoAttuale = calcolaSaldoDinamico(fatture, ricevute, SALDO_BASE.importo, SALDO_BASE.data);

  // ── Entrate ───────────────────────────────────────────────────────────────
  const incassatoYTD = fatture
    .filter(f => f.status === "Pagata" && f.dataIncasso && f.dataIncasso.startsWith(`${ANNO}`) && f.dataIncasso <= oggiStr)
    .reduce((s, f) => s + f.incassoNetto, 0);

  const fattureInForecast = fatture.filter(f =>
    f.status === "Inviata" ||
    (f.status === "Da inviare" && f.dataIncassoAtteso != null)
  );

  const entrateAttesaPerMese = Array(12).fill(0) as number[];
  const entrateDettaglio: { nome: string; status: string; importo: number; dataAttesa: string; stimata: boolean }[] = [];

  for (const f of fattureInForecast) {
    const stimata = !f.dataIncassoAtteso;
    let d: Date;
    if (f.dataIncassoAtteso) {
      d = new Date(f.dataIncassoAtteso + "T00:00:00");
    } else {
      d = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(today);
      d.setDate(d.getDate() + 30);
    }
    if (d < today) d = new Date(today);
    const dataAttesa = d.toISOString().split("T")[0];
    if (d.getFullYear() !== ANNO) {
      entrateDettaglio.push({ nome: f.nome, status: f.status, importo: Math.round(f.incassoNetto * 100) / 100, dataAttesa, stimata });
      continue;
    }
    const m = d.getMonth();
    entrateAttesaPerMese[m] += f.incassoNetto;
    entrateDettaglio.push({ nome: f.nome, status: f.status, importo: Math.round(f.incassoNetto * 100) / 100, dataAttesa, stimata });
  }
  const daIncassare = entrateAttesaPerMese.reduce((s, v) => s + v, 0);

  // ── Uscite ────────────────────────────────────────────────────────────────
  type Uscita = { data: string; mese: number; label: string; importo: number; tipo: string };
  const uscite: Uscita[] = [];

  // IVA
  const ivaPerTrimestre = new Map<string, { certo: number; atteso: number }>();
  for (const f of fatture) {
    if (f.trimestreIVA && f.status === "Pagata") {
      const prev = ivaPerTrimestre.get(f.trimestreIVA) ?? { certo: 0, atteso: 0 };
      ivaPerTrimestre.set(f.trimestreIVA, { ...prev, certo: prev.certo + f.iva22 });
    }
  }
  for (const f of fattureInForecast) {
    let d: Date;
    if (f.dataIncassoAtteso) d = new Date(f.dataIncassoAtteso + "T00:00:00");
    else { d = f.dataInvio ? new Date(f.dataInvio + "T00:00:00") : new Date(today); d.setDate(d.getDate() + 30); }
    if (d < today) d = new Date(today);
    const trim = calcolaTrimestre(d.toISOString().split("T")[0]);
    if (!trim) continue;
    const prev = ivaPerTrimestre.get(trim) ?? { certo: 0, atteso: 0 };
    ivaPerTrimestre.set(trim, { ...prev, atteso: prev.atteso + f.iva22 });
  }
  const ivaCredito = calcolaIVACreditoPerTrimestre(ricevute, COSTI_RICORRENTI, ANNO);
  for (const [trimestre, { certo, atteso }] of Array.from(ivaPerTrimestre)) {
    const scadStr = scadenzaVersamentoIVA(trimestre);
    const [d, m, y] = scadStr.split("/").map(Number);
    const scad = new Date(y, m - 1, d); scad.setHours(0, 0, 0, 0);
    if (scad < today || scad > fineAnno) continue;
    const credito = Math.round((ivaCredito.get(trimestre) ?? 0) * 100) / 100;
    const calcolata = Math.max(0, Math.round((certo + atteso - credito) * 100) / 100);
    const ivaNetta = IVA_VERSAMENTI[trimestre] ?? calcolata;
    uscite.push({ data: scad.toISOString().split("T")[0], mese: scad.getMonth(), label: `IVA ${trimestre} — ${periodoTrimestre(trimestre)}${IVA_VERSAMENTI[trimestre] ? " [confermato]" : ""}`, importo: ivaNetta, tipo: "iva" });
  }

  // Mutuo
  for (let i = 0; i < MUTUO.nRateRimanenti; i++) {
    const d = new Date(MUTUO.prossimaRata); d.setMonth(d.getMonth() + i); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d.toISOString().split("T")[0], mese: d.getMonth(), label: "Rata mutuo", importo: MUTUO.importoRata, tipo: "mutuo" });
  }

  // Anticipo soci
  for (const a of anticipiSoci) {
    const d = new Date(a.data); d.setHours(0, 0, 0, 0);
    if (d < today || d > fineAnno) continue;
    uscite.push({ data: d.toISOString().split("T")[0], mese: d.getMonth(), label: "Anticipo soci", importo: a.importo, tipo: "anticipo_soci" });
  }

  // Fornitori
  for (const f of ricevute) {
    if ((f.status !== "Ricevuta" && f.status !== "In ritardo") || !f.scadenza) continue;
    const d = new Date(f.scadenza); d.setHours(0, 0, 0, 0);
    if (d > fineAnno) continue;
    const dataEff = d < today ? new Date(today) : d;
    uscite.push({ data: dataEff.toISOString().split("T")[0], mese: dataEff.getMonth(), label: d < today ? `${f.nome} ⚠ scaduta` : f.nome, importo: f.importo, tipo: "fornitore" });
  }

  // Costi ricorrenti
  for (const costo of COSTI_RICORRENTI) {
    const importoLordo = Math.round(costo.importoNetto * (1 + costo.aliquotaIVA) * 100) / 100;
    const freq = costo.frequenzaMesi ?? 1;
    for (let m = 0; m <= 11; m++) {
      if (freq > 1 && costo.primaData) {
        const diff = (ANNO - costo.primaData.anno) * 12 + (m - costo.primaData.mese);
        if (diff < 0 || diff % freq !== 0) continue;
      }
      const lastDay = new Date(ANNO, m + 1, 0).getDate();
      const d = new Date(ANNO, m, Math.min(costo.giornoAddebito, lastDay)); d.setHours(0, 0, 0, 0);
      if (d < today || d > fineAnno) continue;
      uscite.push({ data: d.toISOString().split("T")[0], mese: m, label: costo.label, importo: importoLordo, tipo: "abbonamento" });
    }
  }

  // Ritenute
  for (const f of ricevute) {
    if (!f.importoRitenuta) continue;
    const dataBase = f.dataPagamento ? new Date(f.dataPagamento)
      : f.scadenza ? (new Date(f.scadenza) < today ? new Date(today) : new Date(f.scadenza))
      : null;
    if (!dataBase) continue;
    const scad = scadenzaRitenuta(dataBase);
    if (scad < today || scad > fineAnno) continue;
    uscite.push({ data: scad.toISOString().split("T")[0], mese: scad.getMonth(), label: `Ritenuta ${f.nome}`, importo: f.importoRitenuta, tipo: "ritenuta" });
  }

  uscite.sort((a, b) => a.data.localeCompare(b.data));

  const totaleUscite = uscite.reduce((s, u) => s + u.importo, 0);
  const saldoConservativo = saldoAttuale - totaleUscite;
  const saldoOttimistico  = saldoAttuale + daIncassare - totaleUscite;

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
      .filter(f => f.status === "Ricevuta" || f.status === "In ritardo")
      .map(f => ({ nome: f.nome, importo: f.importo, scadenza: f.scadenza, status: f.status }))
      .sort((a, b) => (a.scadenza ?? "").localeCompare(b.scadenza ?? "")),
  });
}

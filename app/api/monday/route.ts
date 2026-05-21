import { NextResponse } from "next/server";
import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import { scadenzaVersamentoIVA } from "@/lib/utils";
import type { MondayAlert } from "@/lib/types";

export async function GET() {
  try {
    const [fatturePages, fattureRicevutePages, notePages] =
      await Promise.all([
        queryAll(DB.FATTURE),
        queryAll(DB.FATTURE_RICEVUTE),
        queryAll(DB.NOTE_SPESE),
      ]);

    const fatture = fatturePages.map(mapFattura);
    const fattureRicevute = fattureRicevutePages.map(mapFatturaRicevuta);
    const note = notePages.map(mapNotaSpese);

    const alerts: MondayAlert[] = [];

    const daInviare = fatture.filter((f) => f.status === "Da inviare");
    if (daInviare.length > 0) {
      alerts.push({ tipo: "fattura_da_inviare", count: daInviare.length, urgente: false, label: "Fatture da inviare", href: "/fatture?status=Da+inviare" });
    }

    const inRitardo = fatture.filter((f) => f.status === "In ritardo");
    if (inRitardo.length > 0) {
      alerts.push({ tipo: "fattura_ritardo", count: inRitardo.length, urgente: true, label: "Fatture in ritardo", href: "/fatture?status=In+ritardo" });
    }

    const daPagare = fattureRicevute.filter((f) => f.status === "Ricevuta");
    if (daPagare.length > 0) {
      alerts.push({ tipo: "spesa_da_pagare", count: daPagare.length, urgente: false, label: "Fatture fornitori da pagare", href: "/fatture-ricevute?status=Ricevuta" });
    }

    const daRimborsare = note.filter((n) => n.statusRimborso === "Da rimborsare");
    if (daRimborsare.length > 0) {
      alerts.push({ tipo: "rimborso_da_liquidare", count: daRimborsare.length, urgente: false, label: "Rimborsi da liquidare", href: "/note-spese?status=Da+rimborsare" });
    }

    // Scadenze IVA calcolate dalle fatture
    const today = new Date();
    const ivaPerTrimestre = new Set<string>();
    for (const f of fatture) {
      if (f.trimestreIVA && f.status === "Pagata") ivaPerTrimestre.add(f.trimestreIVA);
    }
    const scadenzeImminenti = Array.from(ivaPerTrimestre).filter((trimestre) => {
      const scadenzaStr = scadenzaVersamentoIVA(trimestre);
      const [d, m, y] = scadenzaStr.split("/").map(Number);
      const scadenzaDate = new Date(y, m - 1, d);
      const diffDays = (scadenzaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 15;
    });
    if (scadenzeImminenti.length > 0) {
      alerts.push({ tipo: "scadenza_iva", count: scadenzeImminenti.length, urgente: true, label: "Scadenze IVA imminenti", href: "/scadenze-iva" });
    }

    return NextResponse.json({ alerts, ok: alerts.length === 0 });
  } catch (err) {
    console.error("[monday] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

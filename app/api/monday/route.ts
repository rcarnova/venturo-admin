import { NextResponse } from "next/server";
import { DB, queryAll, mapFattura, mapScadenza, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import { isUrgent } from "@/lib/utils";
import type { MondayAlert } from "@/lib/types";

export async function GET() {
  try {
    const [fatturePages, scadenzePages, fattureRicevutePages, notePages] =
      await Promise.all([
        queryAll(DB.FATTURE),
        queryAll(DB.SCADENZE_IVA),
        queryAll(DB.FATTURE_RICEVUTE),
        queryAll(DB.NOTE_SPESE),
      ]);

    const fatture = fatturePages.map(mapFattura);
    const scadenze = scadenzePages.map(mapScadenza);
    const fattureRicevute = fattureRicevutePages.map(mapFatturaRicevuta);
    const note = notePages.map(mapNotaSpese);

    const alerts: MondayAlert[] = [];

    // 1. Fatture da inviare
    const daInviare = fatture.filter((f) => f.status === "Da inviare");
    if (daInviare.length > 0) {
      alerts.push({
        tipo: "fattura_da_inviare",
        count: daInviare.length,
        urgente: false,
        label: "Fatture da inviare",
        href: "/fatture?status=Da+inviare",
      });
    }

    // 2. Fatture in ritardo
    const inRitardo = fatture.filter((f) => f.status === "In ritardo");
    if (inRitardo.length > 0) {
      alerts.push({
        tipo: "fattura_ritardo",
        count: inRitardo.length,
        urgente: true,
        label: "Fatture in ritardo",
        href: "/fatture?status=In+ritardo",
      });
    }

    // 3. Fatture fornitori da pagare
    const daPagare = fattureRicevute.filter((f) => f.status === "Ricevuta");
    if (daPagare.length > 0) {
      alerts.push({
        tipo: "spesa_da_pagare",
        count: daPagare.length,
        urgente: false,
        label: "Fatture fornitori da pagare",
        href: "/fatture-ricevute?status=Ricevuta",
      });
    }

    // 4. Rimborsi da liquidare
    const daRimborsare = note.filter(
      (n) => n.statusRimborso === "Da rimborsare"
    );
    if (daRimborsare.length > 0) {
      alerts.push({
        tipo: "rimborso_da_liquidare",
        count: daRimborsare.length,
        urgente: false,
        label: "Rimborsi da liquidare",
        href: "/note-spese?status=Da+rimborsare",
      });
    }

    // 5. Scadenze IVA imminenti (entro 15gg)
    const scadenzeImminenti = scadenze.filter(
      (s) =>
        s.status === "Da calcolare" &&
        isUrgent(s.scadenzaVersamento, 15)
    );
    if (scadenzeImminenti.length > 0) {
      alerts.push({
        tipo: "scadenza_iva",
        count: scadenzeImminenti.length,
        urgente: true,
        label: "Scadenze IVA imminenti",
        href: "/scadenze-iva",
      });
    }

    return NextResponse.json({ alerts, ok: alerts.length === 0 });
  } catch (err) {
    console.error("[monday] GET error:", err);
    return NextResponse.json({ error: "Errore Notion" }, { status: 500 });
  }
}

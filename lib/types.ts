// ─── FATTURE ────────────────────────────────────────────────────────────────
export type FatturaStatus =
  | "Da inviare"
  | "Inviata"
  | "Pagata"
  | "In ritardo";

export type TrimestreIVA =
  | "Q1 2024" | "Q2 2024" | "Q3 2024" | "Q4 2024"
  | "Q1 2025" | "Q2 2025" | "Q3 2025" | "Q4 2025"
  | "Q1 2026" | "Q2 2026" | "Q3 2026" | "Q4 2026"
  | "Q1 2027" | "Q2 2027" | "Q3 2027" | "Q4 2027"
  | "Q1 2028" | "Q2 2028" | "Q3 2028" | "Q4 2028";

export interface Fattura {
  id: string;
  nome: string;
  importo: number;
  iva22: number;
  status: FatturaStatus;
  trimestreIVA: TrimestreIVA | null;
  dataInvio: string | null;
  dataIncasso: string | null;
  fileFattura: string | null;
  cliente: string | null;
  progetto: string | null;
  createdAt: string;
}

// ─── FATTURE RICEVUTE ────────────────────────────────────────────────────────
export interface FatturaRicevuta {
  id: string;
  nome: string;
  fornitore: string | null;
  dataFattura: string | null;
  scadenza: string | null;
  importo: number;
  status: string | null;
  progetto: string | null;
  fileFattura: string | null;
}

// ─── SCADENZE IVA ────────────────────────────────────────────────────────────
export type ScadenzaStatus =
  | "Da calcolare"
  | "Calcolata"
  | "Versata"
  | "In ritardo";

export interface ScadenzaIVA {
  id: string;
  trimestre: TrimestreIVA;
  periodo: string;
  scadenzaVersamento: string;
  totaleIVA: number | null;
  status: ScadenzaStatus;
}

// ─── FORNITORI ───────────────────────────────────────────────────────────────
export type FornitoreCategoria = "Freelance" | "Agenzia";
export type FornitoreStatus = "Attivo" | "Inattivo";

export interface Fornitore {
  id: string;
  nome: string;
  categoria: FornitoreCategoria;
  pIVA: string | null;
  conIVA: boolean;
  ritenuta: boolean;
  percentualeRitenuta: number | null;
  contatto: string | null;
  email: string | null;
  status: FornitoreStatus;
  note: string | null;
}

// ─── NOTE SPESE ──────────────────────────────────────────────────────────────
export type NotaSpeseOwner = "Rosario" | "Massimo" | "Arianna";
export type NotaSpeseCategoria =
  | "Software"
  | "Abbonamento"
  | "Pasto-Catering"
  | "Trasporto"
  | "Cancelleria"
  | "Altro";
export type NotaSpeseStatus = "Da rimborsare" | "Rimborsato";

export interface NotaSpese {
  id: string;
  descrizione: string;
  owner: NotaSpeseOwner;
  data: string | null;
  importo: number;
  categoria: NotaSpeseCategoria;
  progetto: string | null;
  statusRimborso: NotaSpeseStatus;
  file: string | null;
  protocolloLunedi: boolean;
}

// ─── MONDAY PROTOCOL ─────────────────────────────────────────────────────────
export interface MondayAlert {
  tipo: "fattura_da_inviare" | "fattura_ritardo" | "spesa_da_pagare" | "rimborso_da_liquidare" | "scadenza_iva";
  count: number;
  urgente: boolean;
  label: string;
  href: string;
}

// ─── Saldo bancario ──────────────────────────────────────────────────────────
// Aggiorna importo e data ogni volta che fai una riconciliazione manuale.
// Il tool aggiunge automaticamente tutti i pagamenti (fatture Pagata)
// successivi a questa data.
export const SALDO_BASE = {
  importo: 1_926.17, // 2062.96 - 136.79 (rata mutuo 21/09/2026)
  data: "2026-09-01", // riconciliazione 01/09/2026 — anticipo soci set (€2k Rosario + €2k Massimo)
};

// ─── Fido bancario ───────────────────────────────────────────────────────────
export const FIDO_BANCARIO = 5_000;

// ─── IVA versamenti — override commercialista ─────────────────────────────────
// Quando il commercialista fornisce la cifra esatta, inseriscila qui.
// Sovrascrive il calcolo automatico (utile quando alcune spese non sono detraibili).
// Formato: "Q1 2026" | "Q2 2026" | "Q3 2026" | "Q4 2026" → importo netto da versare
export const IVA_VERSAMENTI: Record<string, number> = {
  "Q2 2026": 4_284.05, // confermato dal commercialista — pagato 25/08/2026 (rimborsato a Massimo)
};

// ─── Mutuo ───────────────────────────────────────────────────────────────────
export const MUTUO = {
  importoRata: 136.79,
  prossimaRata: new Date(2026, 9, 21), // 21 ottobre 2026 — rata settembre pagata il 21/09/2026
  nRateRimanenti: 23,
  totaleRimanente: 3_109.68, // 3_246.47 - 136.79
};

// ─── Anticipo soci ───────────────────────────────────────────────────────────
export const ANTICIPO_SOCI = [
  // luglio pagato il 15/07 (€10.000) — già nel SALDO_BASE
  { data: new Date(2026, 9, 31), importo: 10_000 },  // fine ottobre
  { data: new Date(2026, 11, 31), importo: 10_000 }, // fine dicembre
];

// ─── Costi ricorrenti mensili ─────────────────────────────────────────────────
export type CostoRicorrente = {
  label: string;
  importoNetto: number;  // imponibile senza IVA
  aliquotaIVA: number;   // 0.22, 0.10, 0 etc.
  giornoAddebito: number; // giorno del mese (si cappiccia all'ultimo giorno se il mese è corto)
  frequenzaMesi?: number; // default 1 (mensile); 3 = trimestrale, ecc.
  primaData?: { anno: number; mese: number }; // mese 0-indexed — definisce il ciclo di riferimento
};

export const COSTI_RICORRENTI: CostoRicorrente[] = [
  // Google Workspace, Canva, Aruba PEC, domini e hosting sono in Notion come "Da ricevere" — non duplicare qui

  // ── Costi bancari ────────────────────────────────────────────────────────
  {
    label: "Canone trimestrale",
    importoNetto: 27.25,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 3,
    primaData: { anno: 2025, mese: 11 }, // ciclo: 31/12, 31/03, 30/06, 30/09
  },
  {
    label: "Linea di credito banca",
    importoNetto: 25.00,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 3,
    primaData: { anno: 2025, mese: 11 },
  },
  {
    label: "Canone carta di credito",
    importoNetto: 42.00,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 12,
    primaData: { anno: 2026, mese: 3 }, // 30 apr 2026 (giorno cappato)
  },
  {
    label: "Imposta di bollo c/c",
    importoNetto: 100.00,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 12,
    primaData: { anno: 2025, mese: 11 }, // 31/12 ogni anno
  },
];

// ─── Saldo bancario ──────────────────────────────────────────────────────────
// Aggiorna importo e data ogni volta che fai una riconciliazione manuale.
// Il tool aggiunge automaticamente tutti i pagamenti (fatture Pagata)
// successivi a questa data.
export const SALDO_BASE = {
  importo: 13_708,
  data: "2026-05-21", // data ultima riconciliazione manuale (ISO)
};

// ─── Fido bancario ───────────────────────────────────────────────────────────
export const FIDO_BANCARIO = 5_000;

// ─── Mutuo ───────────────────────────────────────────────────────────────────
export const MUTUO = {
  importoRata: 136.79,
  prossimaRata: new Date(2026, 5, 21), // 21 giugno 2026
  nRateRimanenti: 27,
  totaleRimanente: 3_656.84,
};

// ─── Anticipo soci ───────────────────────────────────────────────────────────
export const ANTICIPO_SOCI = [
  { data: new Date(2026, 6, 31), importo: 14_000 },  // fine luglio
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
  { label: "Google Workspace", importoNetto: 16.20, aliquotaIVA: 0.22, giornoAddebito: 1 },
  {
    label: "Canone trimestrale",
    importoNetto: 27.25,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 3,
    primaData: { anno: 2026, mese: 11 }, // primo addebito: 31 dicembre 2026
  },
  {
    label: "Linea di credito banca",
    importoNetto: 25.00,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 3,
    primaData: { anno: 2026, mese: 11 }, // primo addebito: 31 dicembre 2026
  },
  {
    label: "Canone carta di credito",
    importoNetto: 42.00,
    aliquotaIVA: 0,
    giornoAddebito: 31,
    frequenzaMesi: 12,
    primaData: { anno: 2026, mese: 3 }, // primo addebito: 30 aprile 2026 (apr = 30gg, giorno cappato)
  },
];

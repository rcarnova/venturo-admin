// ─── Saldo bancario ──────────────────────────────────────────────────────────
// Aggiorna importo e data ogni volta che fai una riconciliazione manuale.
// Il tool aggiunge automaticamente tutti i pagamenti (fatture Pagata)
// successivi a questa data.
export const SALDO_BASE = {
  importo: 13_708,
  data: "2026-05-21", // data ultima riconciliazione manuale (ISO)
};

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

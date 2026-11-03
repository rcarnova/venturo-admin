// ─── Saldo bancario ──────────────────────────────────────────────────────────
// Aggiorna importo e data ogni volta che fai una riconciliazione manuale.
// Il tool aggiunge automaticamente tutti i pagamenti (fatture Pagata)
// successivi a questa data.
export const SALDO_BASE = {
  importo: 1_682.73,
  data: "2026-11-02", // riconciliato su estratto Banca Sella del 02/11/2026
};

// ─── Fido bancario ───────────────────────────────────────────────────────────
export const FIDO_BANCARIO = 5_000;

// ─── Target di fatturato annuo ────────────────────────────────────────────────
// Imponibile IVA esclusa (campo "Importo" delle fatture), per anno di emissione.
// 2027: 144.000 € = soglia per 3.000 €/mese netti a socio (stima 03/11/2026:
// split 50/50, gestione separata INPS, IRPEF ordinaria, costi Studio ~3k/anno).
export const TARGET_FATTURATO: Record<number, number> = {
  2026: 90_000,
  2027: 144_000,
};

// Giorni stimati tra la chiusura di un deal e la sua prima fattura: decide in
// quale anno conta la pipe aperta. Conta l'intero valore del deal, non i SAL.
export const PIPE_GIORNI_ALLA_FATTURA = 30;

// ─── IVA versamenti — override commercialista ─────────────────────────────────
// Quando il commercialista fornisce la cifra esatta, inseriscila qui.
// Sovrascrive il calcolo automatico (utile quando alcune spese non sono detraibili).
// Formato: "Q1 2026" | "Q2 2026" | "Q3 2026" | "Q4 2026" → importo netto da versare
export const IVA_VERSAMENTI: Record<string, number> = {
  "Q1 2026": 247.97,   // confermato dal commercialista
  "Q2 2026": 4_284.05, // confermato dal commercialista
  "Q3 2026": 1_247.88, // F24 commercialista, scadenza 16/11/2026 (1.235,52 + 1% interessi trimestrali)
};

// ─── IVA — versamenti effettivi ───────────────────────────────────────────────
// Data del pagamento F24, non la scadenza. Finche' un trimestre non e' qui, il
// report lo mostra come "da confermare" anche se la scadenza e' passata: una
// scadenza trascorsa non prova che il versamento sia avvenuto.
// Formato: "Q2 2026" → "2026-08-25"
export const IVA_VERSATE: Record<string, string> = {
  "Q1 2026": "2026-05-18", // scadenza 16/05 slittata al lunedi
  "Q2 2026": "2026-08-16", // F24 pagato da Massimo dal conto personale, rimborsato il 25/08
};

// ─── Mutuo ───────────────────────────────────────────────────────────────────
export const MUTUO = {
  importoRata: 136.79,
  prossimaRata: new Date(2026, 10, 21), // 21 novembre 2026 — rata ottobre pagata il 21/10/2026
  nRateRimanenti: 22,
  totaleRimanente: 2_972.89, // 3_109.68 - 136.79
};

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

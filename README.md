# Venturo Admin

Pannello di amministrazione per Studio Miller / Venturo.
Connesso ai 5 database Notion via API.

## Setup

### 1. Installa dipendenze
```bash
npm install
```

### 2. Crea Notion Integration
1. Vai su https://www.notion.so/my-integrations
2. Crea una nuova integration: "Venturo Admin"
3. Copia il **Internal Integration Token**

### 3. Condividi i database con l'integration
Per ciascuno dei 5 database su Notion:
1. Apri il database
2. Clicca "..." in alto a destra → "Add connections"
3. Seleziona "Venturo Admin"

I 5 database da condividere:
- Fatture Studio/Venturo
- Scadenze IVA
- Fornitori
- Spese Operative Studio/Venturo
- Note Spese

### 4. Configura .env.local
```bash
cp .env.local.example .env.local
```
Poi inserisci il token Notion nel file `.env.local`.

### 5. Verifica Database IDs
Gli ID dei database sono già nel `.env.local.example`.
Se i tuoi database hanno ID diversi, aggiornali.
L'ID si trova nell'URL Notion: `notion.so/workspace/`**`{database-id}`**`?v=...`

### 6. Avvia in locale
```bash
npm run dev
```
Apri http://localhost:3000

## Deploy su Vercel
```bash
npx vercel
```
Aggiungi le variabili d'ambiente nel dashboard Vercel.

## Struttura

```
app/
├── page.tsx              # Dashboard + Protocollo Lunedì
├── fatture/              # Fatture emesse
├── scadenze-iva/         # Scadenze trimestrali IVA
├── fornitori/            # Fornitori e collaboratori
├── spese/                # Spese operative
└── note-spese/           # Rimborsi spese

lib/
├── notion.ts             # Client Notion + mappers
├── types.ts              # TypeScript types
└── utils.ts              # Helpers (formatEuro, formatDate, ecc.)

app/api/
├── fatture/route.ts      # GET + PATCH fatture
├── scadenze-iva/route.ts # GET + PATCH scadenze
├── fornitori/route.ts    # GET fornitori
├── spese/route.ts        # GET spese
├── note-spese/route.ts   # GET note spese
└── monday/route.ts       # GET monday protocol summary
```

## Note sui nomi delle proprietà Notion

I mapper in `lib/notion.ts` usano i nomi esatti delle proprietà Notion.
Se hai rinominato qualche proprietà, aggiorna i corrispondenti `getTitle/getSelect/getNumber/...`
nei mapper `mapFattura`, `mapScadenza`, ecc.

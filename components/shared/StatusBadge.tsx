import { cn } from "@/lib/utils";

type Variant = "warning" | "success" | "error" | "neutral" | "accent";

const STATUS_MAP: Record<string, Variant> = {
  // Fatture
  "Da inviare": "warning",
  Inviata: "neutral",
  Pagata: "success",
  "In ritardo": "error",
  // Scadenze IVA
  "Da calcolare": "warning",
  Calcolata: "accent",
  Versata: "success",
  // Fornitori / Spese
  Attivo: "success",
  Inattivo: "neutral",
  Scaduto: "error",
  Cancellato: "neutral",
  // Pagamento
  "Da pagare": "warning",
  Pagato: "success",
  // Note Spese
  "Da rimborsare": "warning",
  Rimborsato: "success",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_MAP[status] ?? "neutral";
  return <span className={cn("badge", `badge-${variant}`)}>{status}</span>;
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEuro(amount: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function scadenzaVersamentoIVA(trimestre: string): string {
  const [q, year] = trimestre.split(" ");
  const y = Number(year);
  const dates: Record<string, string> = {
    Q1: `16/05/${y}`,
    Q2: `20/08/${y}`,
    Q3: `16/11/${y}`,
    Q4: `16/03/${y + 1}`,
  };
  return dates[q] ?? "—";
}

export function calcolaTrimestre(dateStr: string): import("./types").TrimestreIVA | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}` as import("./types").TrimestreIVA;
}

export function periodoTrimestre(trimestre: string): string {
  const [q, year] = trimestre.split(" ");
  const periods: Record<string, string> = {
    Q1: `Gen–Mar ${year}`,
    Q2: `Apr–Giu ${year}`,
    Q3: `Lug–Set ${year}`,
    Q4: `Ott–Dic ${year}`,
  };
  return periods[q] ?? trimestre;
}

export function isUrgent(dateStr: string | null, daysThreshold = 15): boolean {
  if (!dateStr) return false;
  const target = new Date(dateStr);
  const now = new Date();
  const diff = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff <= daysThreshold && diff >= 0;
}

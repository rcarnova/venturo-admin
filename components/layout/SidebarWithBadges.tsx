import { DB, queryAll, mapFattura, mapFatturaRicevuta, mapNotaSpese } from "@/lib/notion";
import Sidebar from "./Sidebar";

export async function SidebarWithBadges({ username }: { username?: string }) {
  try {
    const [fatturePages, ricevutePages, notePages] = await Promise.all([
      queryAll(DB.FATTURE),
      queryAll(DB.FATTURE_RICEVUTE),
      queryAll(DB.NOTE_SPESE),
    ]);

    const fatturePendenti = fatturePages.map(mapFattura)
      .filter(f => f.status === "Da inviare" || f.status === "In ritardo").length;
    const ricevutePendenti = ricevutePages.map(mapFatturaRicevuta)
      .filter(f => f.status === "Ricevuta" || f.status === "In ritardo").length;
    const rimborsoPendenti = notePages.map(mapNotaSpese)
      .filter(n => n.statusRimborso === "Da rimborsare").length;

    const badges: Record<string, number> = {};
    if (fatturePendenti > 0) badges["/fatture"] = fatturePendenti;
    if (ricevutePendenti > 0) badges["/fatture-ricevute"] = ricevutePendenti;
    if (rimborsoPendenti > 0) badges["/note-spese"] = rimborsoPendenti;

    return <Sidebar username={username} badges={badges} />;
  } catch {
    return <Sidebar username={username} />;
  }
}

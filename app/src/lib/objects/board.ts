// Kanban-Spalten begrenzen (Belastungstest LR-3). Rein, ohne DB – die Seite lädt je Spalte
// `orderBy: { position: "desc" }, take: BOARD_STAGE_LIMIT` und zählt die Gesamtmenge per groupBy.

export const BOARD_STAGE_LIMIT = 100;

/**
 * Setzt die geladenen Spalten (je Spalte absteigend nach Position) wieder in Anzeige-Reihenfolge
 * (aufsteigend, Spalten in Phasen-Reihenfolge) und berechnet, wie viele Karten je Spalte ausgeblendet sind.
 */
export function boardColumns<T extends { position: number }>(
  stageIds: string[],
  loadedDesc: Record<string, T[]>,
  totals: { stageId: string; count: number }[],
): { deals: T[]; hidden: Record<string, number> } {
  const count = new Map(totals.map((t) => [t.stageId, t.count]));
  const deals: T[] = [];
  const hidden: Record<string, number> = {};
  for (const id of stageIds) {
    const rows = [...(loadedDesc[id] ?? [])].reverse();
    deals.push(...rows);
    hidden[id] = Math.max(0, (count.get(id) ?? rows.length) - rows.length);
  }
  return { deals, hidden };
}

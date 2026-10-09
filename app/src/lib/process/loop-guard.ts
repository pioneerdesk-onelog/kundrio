// Schutz vor Endlosschleifen: Ereignisse, die ein Prozesslauf erzeugt, tragen causedByProcess/causedByRun/depth.
// Ein Prozess wird nie durch Ereignisse aus seinen EIGENEN Läufen ausgelöst; zusätzlich gilt ein Tiefenlimit.

export const MAX_EVENT_DEPTH = 5;

export type CausedBy = { causedByProcess?: string; causedByRun?: string; depth?: number };

export function eventDepth(data: unknown): number {
  const d = (data as CausedBy | null)?.depth;
  return typeof d === "number" && d >= 0 ? d : 0;
}

/** Darf das Ereignis den Prozess auslösen? */
export function mayTrigger(processId: string, eventData: unknown): { ok: boolean; reason?: string } {
  const d = (eventData ?? {}) as CausedBy;
  if (d.causedByProcess === processId) return { ok: false, reason: "Ereignis stammt aus einem eigenen Lauf" };
  if (eventDepth(eventData) >= MAX_EVENT_DEPTH) return { ok: false, reason: `Tiefenlimit ${MAX_EVENT_DEPTH} erreicht` };
  return { ok: true };
}

/** Kennzeichnung für Ereignisse, die ein Lauf erzeugt. */
export function causedBy(processId: string, runId: string, parentDepth: number): CausedBy {
  return { causedByProcess: processId, causedByRun: runId, depth: parentDepth + 1 };
}

// Lifecycle-Phasen nach HubSpot-Vorbild (rein, ohne DB).

export const DEFAULT_LIFECYCLE = [
  { key: "subscriber", label: "Abonnent" },
  { key: "lead", label: "Lead" },
  { key: "mql", label: "Marketing-qualifiziert (MQL)" },
  { key: "sql", label: "Vertriebs-qualifiziert (SQL)" },
  { key: "opportunity", label: "Verkaufschance" },
  { key: "customer", label: "Kunde" },
  { key: "evangelist", label: "Fürsprecher" },
  { key: "other", label: "Sonstiges" },
] as const;

export type StageDef = { key: string; label: string; position: number };

/**
 * Ist der Wechsel ein Rückschritt? "other" ist keine Stufe der Reihe: Wechsel von/nach "other"
 * gelten nie als Rückschritt. Unbekannte Schlüssel ebenso nicht.
 */
export function isBackward(stages: StageDef[], from: string | null | undefined, to: string): boolean {
  if (!from || from === to || from === "other" || to === "other") return false;
  const a = stages.find((s) => s.key === from);
  const b = stages.find((s) => s.key === to);
  if (!a || !b) return false;
  return b.position < a.position;
}

export function stageLabel(stages: { key: string; label: string }[], key: string | null | undefined) {
  if (!key) return "–";
  return stages.find((s) => s.key === key)?.label ?? key;
}

/** Standard-SLA (Stunden bis zur Erledigung) je Ticket-Priorität */
export const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, medium: 24, low: 72 };
export const PRIORITY_LABEL: Record<string, string> = { low: "Niedrig", medium: "Mittel", high: "Hoch", urgent: "Dringend" };
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/** Standard-Ticket-Pipeline „Support“ */
export const TICKET_STAGES = [
  { name: "Neu", kind: "OPEN" as const },
  { name: "Wartet auf uns", kind: "OPEN" as const },
  { name: "Wartet auf Kunde", kind: "OPEN" as const },
  { name: "Geschlossen", kind: "CLOSED" as const },
];

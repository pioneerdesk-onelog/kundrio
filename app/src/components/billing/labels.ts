// Anzeige-Texte für Abos, Mandate, Lastschrift-Stapel.
type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

export const SUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Aktiv", tone: "ok" },
  paused: { label: "Pausiert", tone: "warn" },
  cancelled: { label: "Gekündigt", tone: "bad" },
  ended: { label: "Beendet", tone: "neutral" },
};

export const MANDATE_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Aktiv", tone: "ok" },
  revoked: { label: "Widerrufen", tone: "bad" },
  expired: { label: "Verfallen (36 Monate)", tone: "warn" },
};

export const BATCH_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Entwurf", tone: "neutral" },
  exported: { label: "XML erzeugt", tone: "accent" },
  submitted: { label: "Eingereicht", tone: "warn" },
  settled: { label: "Abgeschlossen", tone: "ok" },
};

export const ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Im Einzug", tone: "accent" },
  collected: { label: "Eingezogen", tone: "ok" },
  returned: { label: "Rücklastschrift", tone: "bad" },
};

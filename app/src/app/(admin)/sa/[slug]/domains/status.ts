// Anzeige der Domain-Status (Text + Farbton).
export const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "accent" }> = {
  pending_dns: { label: "DNS einrichten", tone: "neutral" },
  verifying: { label: "wird geprüft", tone: "accent" },
  active: { label: "aktiv", tone: "ok" },
  error: { label: "Fehler", tone: "bad" },
  removed: { label: "entfernt", tone: "neutral" },
};

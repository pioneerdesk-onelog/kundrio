// Anzeige-Texte und Farben für Zahlungs- und Umsatzstatus.
type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "offen", tone: "neutral" },
  pending: { label: "in Bearbeitung", tone: "accent" },
  authorized: { label: "autorisiert", tone: "accent" },
  paid: { label: "bezahlt", tone: "ok" },
  failed: { label: "fehlgeschlagen", tone: "bad" },
  expired: { label: "abgelaufen", tone: "neutral" },
  canceled: { label: "abgebrochen", tone: "neutral" },
  refunded: { label: "erstattet", tone: "warn" },
  partially_refunded: { label: "teilw. erstattet", tone: "warn" },
};

export const TX_STATUS: Record<string, { label: string; tone: Tone }> = {
  unmatched: { label: "offen", tone: "neutral" },
  suggested: { label: "Vorschlag", tone: "accent" },
  matched: { label: "zugeordnet", tone: "ok" },
  ignored: { label: "ignoriert", tone: "neutral" },
};

export const PROVIDER_LABEL: Record<string, string> = { mollie: "Mollie", revolut: "Revolut", unzer: "Unzer" };
export const SOURCE_LABEL: Record<string, string> = { camt: "CAMT-Import", revolut_business: "Revolut Business (API)", fints: "FinTS" };

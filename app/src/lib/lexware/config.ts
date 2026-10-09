// Lexware Office Public API (ehem. lexoffice). Quelle: https://developers.lexware.io/docs/ (Stand 07.10.2026)
// Schlüssel nur aus der Umgebung (LEXWARE_API_KEY), nie in der Datenbank.

export const LEXWARE_APP_URL = "https://app.lexware.de";

export function lexwareBaseUrl() {
  return (process.env.LEXWARE_BASE_URL || "https://api.lexware.io").replace(/\/+$/, "");
}

export function lexwareKey(): string | null {
  const k = process.env.LEXWARE_API_KEY?.trim();
  return k ? k : null;
}

export function lexwareConfigured() {
  return lexwareKey() !== null;
}

/** Deeplinks in die Lexware-Weboberfläche. */
export type LexVoucherType = "invoice" | "quotation" | "order-confirmation";

/** API-Pfad bzw. Permalink-Segment je Belegtyp. */
export const LEX_PATH: Record<LexVoucherType, string> = { invoice: "invoices", quotation: "quotations", "order-confirmation": "order-confirmations" };

export function lexwareDeeplink(kind: LexVoucherType, id: string, mode: "view" | "edit" = "view") {
  return `${LEXWARE_APP_URL}/permalink/${LEX_PATH[kind]}/${mode}/${encodeURIComponent(id)}`;
}

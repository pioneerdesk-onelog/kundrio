import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

// Rufnummern einheitlich als E.164 (+491701234567). Rein, ohne DB – testbar.

/** Normalisiert eine Rufnummer nach E.164; ohne Ländervorwahl wird `defaultCountry` angenommen. null = ungültig. */
export function toE164(raw: string | null | undefined, defaultCountry: CountryCode = "DE"): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  // WhatsApp liefert Nummern ohne „+“ (wa_id), z. B. 491701234567
  const candidate = /^\d{8,15}$/.test(s) && !s.startsWith("0") ? `+${s}` : s.replace(/^00/, "+");
  const p = parsePhoneNumberFromString(candidate, defaultCountry);
  return p && p.isValid() ? p.number : null;
}

export function isE164(s: string | null | undefined): boolean {
  return Boolean(s && /^\+[1-9]\d{6,14}$/.test(s));
}

/** WhatsApp Cloud API erwartet die Nummer mit Ländervorwahl; „+“ ist erlaubt (empfohlen). */
export function forWhatsApp(e164: string): string {
  return e164;
}

/** Letzte Ziffern für eine grobe Vorauswahl in der Datenbank (Kontaktsuche per Telefonnummer). */
export function lastDigits(e164: string, n = 7): string {
  return e164.replace(/\D/g, "").slice(-n);
}

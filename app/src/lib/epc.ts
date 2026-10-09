import { isValidBic, isValidIban, normalizeIban } from "./compliance-validators";

// EPC-QR („GiroCode“) nach EPC069-12, Version 002, Zeichensatz 1 = UTF-8, SEPA-Überweisung (SCT).

export function epcPayload(input: { name: string; iban: string; bic?: string | null; amountCents: number; text: string }) {
  const iban = normalizeIban(input.iban);
  if (!isValidIban(iban)) throw new Error("IBAN ungültig");
  const bic = (input.bic ?? "").replace(/\s+/g, "").toUpperCase();
  if (bic && !isValidBic(bic)) throw new Error("BIC ungültig");
  if (input.amountCents < 1 || input.amountCents > 99_999_999_999) throw new Error("Betrag außerhalb des EPC-Bereichs");
  const name = input.name.replace(/[\r\n]/g, " ").trim().slice(0, 70);
  if (!name) throw new Error("Empfängername fehlt");
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    bic,
    name,
    iban,
    `EUR${(input.amountCents / 100).toFixed(2)}`,
    "", // Purpose
    "", // strukturierte Referenz
    input.text.replace(/[\r\n]/g, " ").trim().slice(0, 140),
  ];
  const payload = lines.join("\n");
  if (new TextEncoder().encode(payload).length > 331) throw new Error("EPC-Daten zu lang");
  return payload;
}

import "server-only";
import { db } from "../db";
import { payPageUrl, paymentsEnabled } from "./service";

// Platzhalter {{ invoice.paymentLink }} für Rechnungstexte, E-Mails und Kundenportal.
// Der Link zeigt auf die eigene Bezahlseite /zahlung/<token> (läuft nicht ab); erst dort wird beim Klick
// auf „Jetzt bezahlen“ die Zahlung beim Anbieter angelegt bzw. wiederverwendet.

export const PAYMENT_LINK_KEY = "invoice.paymentLink";
const PATTERN = /\{\{\s*invoice\.paymentLink\s*\}\}/g;

/** Wert für den Platzhalter – leer, wenn kein Anbieter verbunden ist oder nichts zu zahlen ist. */
export async function paymentLinkFor(workspaceId: string, invoiceId: string): Promise<string> {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId }, select: { kind: true, status: true, currency: true } });
  if (!inv || inv.kind !== "INVOICE" || inv.status === "PAID" || inv.status === "CANCELLED" || inv.currency !== "EUR") return "";
  if (!(await paymentsEnabled(workspaceId))) return "";
  return payPageUrl(invoiceId);
}

/** Variablen-Objekt zum Zusammenführen mit anderen Platzhaltern: { "invoice.paymentLink": "https://…" } */
export async function paymentPlaceholders(workspaceId: string, invoiceId: string): Promise<Record<string, string>> {
  return { [PAYMENT_LINK_KEY]: await paymentLinkFor(workspaceId, invoiceId) };
}

/** Platzhalter direkt in einem Text ersetzen (ohne Link: Platzhalter entfällt). */
export function replacePaymentLink(text: string, url: string): string {
  return text.replace(PATTERN, url);
}

// Reine Berechnung: Was ist auf eine Rechnung eingegangen, was ist offen? (testbar ohne Datenbank)
import { SETTLED_STATUSES, type PaymentStatus } from "./types";

export type PaymentLike = { status: string; amountCents: number; refundedCents: number };
export type BankLike = { amountCents: number };

/** Netto eingegangen über Online-Zahlungen (bezahlt abzüglich Erstattungen). */
export function onlineNetCents(payments: PaymentLike[]): number {
  return payments.filter((p) => (SETTLED_STATUSES as readonly string[]).includes(p.status)).reduce((s, p) => s + Math.max(0, p.amountCents - p.refundedCents), 0);
}

/** Über den Kontoabgleich bestätigte Eingänge (nur positive Buchungen). */
export function bankNetCents(txs: BankLike[]): number {
  return txs.reduce((s, t) => s + (t.amountCents > 0 ? t.amountCents : 0), 0);
}

export function openCents(grossCents: number, payments: PaymentLike[], bank: BankLike[] = []): number {
  return Math.max(0, grossCents - onlineNetCents(payments) - bankNetCents(bank));
}

export type InvoiceTransition = "paid" | "partial" | "reopened" | "none";

/**
 * Status-Folge für die Rechnung. Nur vollständig bezahlte Rechnungen werden PAID;
 * eine bezahlte Rechnung wird nach Erstattung (wieder offen) auf SENT zurückgesetzt.
 */
export function invoiceTransition(invoiceStatus: string, grossCents: number, paidBefore: number, paidAfter: number): InvoiceTransition {
  if (invoiceStatus === "CANCELLED" || invoiceStatus === "DRAFT") return "none";
  if (paidAfter >= grossCents && grossCents > 0) return invoiceStatus === "PAID" ? "none" : "paid";
  if (invoiceStatus === "PAID" && paidAfter < paidBefore) return "reopened";
  if (paidAfter > paidBefore) return "partial";
  return "none";
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  open: "offen",
  pending: "in Bearbeitung",
  authorized: "autorisiert",
  paid: "bezahlt",
  failed: "fehlgeschlagen",
  expired: "abgelaufen",
  canceled: "abgebrochen",
  refunded: "erstattet",
  partially_refunded: "teilweise erstattet",
};

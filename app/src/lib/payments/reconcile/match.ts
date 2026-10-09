// Zuordnung Kontoumsatz → Rechnung (reine Funktionen, testbar).
// Grundsatz (Freigabe-Prinzip): Automatisch zugeordnet wird NUR bei exakter eigener Kennung
//   – EndToEndId einer eigenen Lastschrift (DirectDebitItem.endToEndId), auch bei Rücklastschriften,
//   – eigene Zahlungs-ID eines Anbieters (Payment.externalId, z. B. tr_…) im Verwendungszweck.
// Alles andere (Rechnungsnummer, Betrag, Name) ergibt nur einen VORSCHLAG, den ein Mensch bestätigt.

export type MatchTx = { amountCents: number; remittance: string | null; counterparty: string | null; endToEndId: string | null; mandateRef?: string | null };
export type MatchInvoice = { id: string; number: string; grossCents: number; openCents: number; names: string[] };
export type MatchDebit = { id: string; invoiceId: string; endToEndId: string; amountCents: number; status: string; mandateRef: string };
export type MatchPayment = { id: string; invoiceId: string | null; externalId: string };

export type MatchResult =
  | { kind: "auto"; invoiceId: string; reason: string; debitItemId?: string; isReturn: boolean }
  | { kind: "suggest"; invoiceId: string; score: number; reasons: string[] }
  | { kind: "none" };

export const SUGGEST_MIN = 40;

/** Für Vergleiche: Großbuchstaben, nur Buchstaben/Ziffern. */
export const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Rechnungsnummer tolerant im Verwendungszweck finden (Leer-/Trennzeichen, Groß/klein egal). */
export function numberInText(number: string, text: string): "exact" | "digits" | null {
  const n = norm(number);
  const t = norm(text);
  if (n.length >= 4 && t.includes(n)) return "exact";
  // Nur der Ziffernteil (z. B. „2026-0042“ statt „RE-2026-0042“), mind. 6 Ziffern, nicht Teil einer längeren Zahl
  const digits = number.replace(/\D/g, "");
  if (digits.length >= 6) {
    const tDigits = text.replace(/[\s\-/.]/g, "");
    const re = new RegExp(`(^|\\D)${digits}(\\D|$)`);
    if (re.test(tDigits)) return "digits";
  }
  return null;
}

function tokens(s: string) {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\b(gmbh|ag|ug|kg|ohg|e\.?k|mbh|co|und|haftungsbeschrankt|herr|frau|dr)\b/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
}

/** Namensähnlichkeit 0..1 (Dice über Wort-Token). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const t of x) if (y.has(t)) common++;
  return (2 * common) / (x.size + y.size);
}

export function scoreInvoice(tx: MatchTx, inv: MatchInvoice): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const hit = tx.remittance ? numberInText(inv.number, tx.remittance) : null;
  if (hit === "exact") {
    score += 60;
    reasons.push(`Rechnungsnummer ${inv.number} im Verwendungszweck`);
  } else if (hit === "digits") {
    score += 45;
    reasons.push(`Ziffern der Rechnungsnummer ${inv.number} im Verwendungszweck`);
  }
  if (tx.amountCents === inv.openCents) {
    score += 30;
    reasons.push("Betrag entspricht dem offenen Betrag");
  } else if (tx.amountCents === inv.grossCents) {
    score += 15;
    reasons.push("Betrag entspricht dem Rechnungsbetrag");
  } else if (hit && tx.amountCents < inv.openCents) {
    reasons.push("Teilbetrag");
  } else if (hit && tx.amountCents > inv.openCents) {
    score -= 10;
    reasons.push("Betrag höher als offen");
  }
  const sim = Math.max(0, ...inv.names.map((n) => nameSimilarity(tx.counterparty, n)));
  if (sim >= 0.5) {
    score += 10;
    reasons.push(`Name ähnlich (schwaches Indiz, ${Math.round(sim * 100)} %)`);
  }
  return { score, reasons };
}

export function matchTransaction(tx: MatchTx, ctx: { invoices: MatchInvoice[]; debits: MatchDebit[]; payments: MatchPayment[] }): MatchResult {
  // 1) Eigene Lastschrift per EndToEndId (Eingang = Einzug, Ausgang = Rücklastschrift)
  if (tx.endToEndId) {
    const d = ctx.debits.find((x) => x.endToEndId === tx.endToEndId);
    if (d) {
      if (tx.amountCents < 0) return { kind: "auto", invoiceId: d.invoiceId, debitItemId: d.id, isReturn: true, reason: `Rücklastschrift zur eigenen Lastschrift (EndToEndId ${d.endToEndId})` };
      if (tx.amountCents === d.amountCents) return { kind: "auto", invoiceId: d.invoiceId, debitItemId: d.id, isReturn: false, reason: `Eigene Lastschrift (EndToEndId ${d.endToEndId})` };
    }
  }
  // 2) Eigene Zahlungs-ID eines Anbieters im Verwendungszweck (exakt, mit Wortgrenze)
  if (tx.remittance && tx.amountCents > 0) {
    for (const p of ctx.payments) {
      if (!p.invoiceId || p.externalId.length < 8) continue;
      const re = new RegExp(`(^|[^A-Za-z0-9_-])${p.externalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`);
      if (re.test(tx.remittance)) return { kind: "auto", invoiceId: p.invoiceId, isReturn: false, reason: `Eigene Zahlungs-ID ${p.externalId}` };
    }
  }
  if (tx.amountCents <= 0) return { kind: "none" };
  // 3) Vorschläge
  let best: { inv: MatchInvoice; score: number; reasons: string[] } | null = null;
  let tie = false;
  for (const inv of ctx.invoices) {
    if (inv.openCents <= 0) continue;
    const s = scoreInvoice(tx, inv);
    if (!best || s.score > best.score) {
      best = { inv, ...s };
      tie = false;
    } else if (s.score === best.score) tie = true;
  }
  if (!best || best.score < SUGGEST_MIN) return { kind: "none" };
  const reasons = tie ? [...best.reasons, "Achtung: weitere Rechnung mit gleicher Bewertung"] : best.reasons;
  return { kind: "suggest", invoiceId: best.inv.id, score: Math.min(100, best.score), reasons };
}

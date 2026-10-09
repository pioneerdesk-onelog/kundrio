import "server-only";
import { db } from "../../db";
import { audit } from "../../audit";
import { errMessage, log } from "../../log";
import { recordReturn } from "../../billing/service";
import { RETURN_REASONS } from "../../billing/sepa";
import { openCredentials, sealCredentials } from "../crypto";
import { applyInvoiceEffects, invoiceOpenCents, PaymentsError } from "../service";
import { onlineNetCents, bankNetCents } from "../settlement";
import { parseCamt, type BankTxInput } from "./camt";
import { matchTransaction, type MatchDebit, type MatchInvoice, type MatchPayment } from "./match";
import { ensureAccess, exchangeCode, fetchTransactions, listAccounts, mapRevolutTransactions, type RevolutBizCreds } from "./revolut-business";

// Kontoabgleich: Umsätze importieren (CAMT-Datei, Revolut Business), Rechnungen zuordnen.
// Automatisch nur bei exakter eigener Kennung (siehe match.ts); sonst Vorschlag → Mensch bestätigt.

export const SUGGEST_PREFIX = "vorschlag:";

// ---------- Import ----------

async function insertTransactions(workspaceId: string, accountId: string, rows: BankTxInput[]) {
  if (!rows.length) return { inserted: 0, ids: [] as string[] };
  const before = new Set((await db.bankTransaction.findMany({ where: { accountId, externalId: { in: rows.map((r) => r.externalId) } }, select: { externalId: true } })).map((r) => r.externalId));
  const fresh = rows.filter((r) => !before.has(r.externalId));
  await db.bankTransaction.createMany({
    data: fresh.map((r) => ({
      workspaceId,
      accountId,
      externalId: r.externalId,
      bookingDate: new Date(`${r.bookingDate}T00:00:00Z`),
      amountCents: r.amountCents,
      currency: r.currency,
      counterparty: r.counterparty,
      counterpartyIbanLast4: r.counterpartyIbanLast4,
      // Rückgabegrund für die Zuordnung im Verwendungszweck mitführen (kein eigenes Feld im Schema)
      remittance: r.isReturn ? `[Rückgabe${r.returnReason ? ` ${r.returnReason}` : ""}] ${r.remittance ?? ""}`.trim().slice(0, 1000) : r.remittance,
      endToEndId: r.endToEndId,
    })),
    skipDuplicates: true,
  });
  const ids = (await db.bankTransaction.findMany({ where: { accountId, externalId: { in: fresh.map((r) => r.externalId) } }, select: { id: true } })).map((r) => r.id);
  return { inserted: ids.length, ids };
}

export async function importCamt(workspaceId: string, xml: string, actor: string, accountId?: string | null) {
  let stmt;
  try {
    stmt = parseCamt(xml);
  } catch (e) {
    throw new PaymentsError(`Kontoauszug nicht lesbar: ${errMessage(e)}`);
  }
  let account = accountId ? await db.bankAccount.findFirst({ where: { id: accountId, workspaceId } }) : null;
  if (accountId && !account) throw new PaymentsError("Bankkonto nicht gefunden.");
  if (account && stmt.ibanLast4 && account.ibanLast4 && account.ibanLast4 !== stmt.ibanLast4) throw new PaymentsError(`Der Auszug gehört zu IBAN …${stmt.ibanLast4}, gewählt ist …${account.ibanLast4}.`);
  if (!account && stmt.ibanLast4) account = await db.bankAccount.findFirst({ where: { workspaceId, source: "camt", ibanLast4: stmt.ibanLast4 } });
  if (!account) account = await db.bankAccount.create({ data: { workspaceId, name: `Konto …${stmt.ibanLast4 ?? "????"}`, source: "camt", ibanLast4: stmt.ibanLast4, currency: stmt.currency } });
  const { inserted, ids } = await insertTransactions(workspaceId, account.id, stmt.entries);
  await db.bankAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), lastError: null } });
  const m = await runMatching(workspaceId, ids, actor);
  await audit({ workspaceId, actor, action: "bank.camt_imported", target: account.id, detail: { format: stmt.version, entries: stmt.entries.length, inserted, ...m } });
  return { accountId: account.id, format: stmt.version, entries: stmt.entries.length, inserted, duplicates: stmt.entries.length - inserted, ...m };
}

// ---------- Revolut Business ----------

export async function connectRevolutBusiness(workspaceId: string, input: { name: string; mode: "test" | "live"; clientId: string; privateKey: string; issuer: string; code?: string; refreshToken?: string }, actor: string) {
  if (!/^-----BEGIN (RSA )?PRIVATE KEY-----/.test(input.privateKey.trim())) throw new PaymentsError("Privater Schlüssel im PEM-Format fehlt.");
  let creds: RevolutBizCreds = { mode: input.mode, clientId: input.clientId.trim(), privateKey: input.privateKey.trim(), issuer: input.issuer.trim(), refreshToken: input.refreshToken?.trim() || undefined };
  if (input.code?.trim()) creds = await exchangeCode(creds, input.code.trim());
  const access = await ensureAccess(creds);
  creds = access.creds;
  const accounts = (await listAccounts(creds)).filter((a) => a.currency === "EUR" && (a.state ?? "active") === "active");
  if (!accounts.length) throw new PaymentsError("Kein aktives EUR-Konto bei Revolut Business gefunden.");
  creds.accountId = accounts[0].id;
  const acc = await db.bankAccount.create({
    data: { workspaceId, name: input.name || accounts[0].name || "Revolut Business", source: "revolut_business", currency: "EUR", credentials: sealCredentials(creds as unknown as Record<string, string>) },
  });
  await audit({ workspaceId, actor, action: "bank.revolut_connected", target: acc.id, detail: { mode: input.mode } });
  return acc.id;
}

export async function syncBankAccount(accountId: string, actor = "system:bank.sync") {
  const acc = await db.bankAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.source !== "revolut_business") return null;
  try {
    const stored = openCredentials(acc.credentials) as unknown as RevolutBizCreds;
    const { creds, changed } = await ensureAccess(stored);
    if (changed) await db.bankAccount.update({ where: { id: acc.id }, data: { credentials: sealCredentials(creds as unknown as Record<string, string>) } });
    const from = new Date((acc.lastSyncAt?.getTime() ?? Date.now() - 90 * 86400_000) - 3 * 86400_000);
    const rows = mapRevolutTransactions(await fetchTransactions(creds, from), creds.accountId ?? "");
    const { inserted, ids } = await insertTransactions(acc.workspaceId, acc.id, rows);
    await db.bankAccount.update({ where: { id: acc.id }, data: { lastSyncAt: new Date(), lastError: null } });
    const m = await runMatching(acc.workspaceId, ids, actor);
    return { inserted, ...m };
  } catch (e) {
    await db.bankAccount.update({ where: { id: acc.id }, data: { lastError: errMessage(e).slice(0, 500) } });
    throw e;
  }
}

// ---------- Zuordnung ----------

async function matchContext(workspaceId: string) {
  const invoices = await db.invoice.findMany({
    where: { workspaceId, kind: "INVOICE", status: { in: ["SENT", "ACCEPTED"] }, currency: "EUR" },
    select: { id: true, number: true, grossCents: true, buyerName: true, contact: { select: { firstName: true, lastName: true } } },
    take: 5000,
  });
  const ids = invoices.map((i) => i.id);
  const [payments, bank] = await Promise.all([
    db.payment.findMany({ where: { workspaceId, invoiceId: { in: ids } }, select: { invoiceId: true, status: true, amountCents: true, refundedCents: true } }),
    db.bankTransaction.findMany({ where: { workspaceId, matchedInvoiceId: { in: ids }, status: "matched" }, select: { matchedInvoiceId: true, amountCents: true } }),
  ]);
  const minv: MatchInvoice[] = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    grossCents: i.grossCents,
    openCents: Math.max(0, i.grossCents - onlineNetCents(payments.filter((p) => p.invoiceId === i.id)) - bankNetCents(bank.filter((b) => b.matchedInvoiceId === i.id))),
    names: [i.buyerName, [i.contact?.firstName, i.contact?.lastName].filter(Boolean).join(" ")].filter((n): n is string => Boolean(n)),
  }));
  const debits: MatchDebit[] = (
    await db.directDebitItem.findMany({ where: { batch: { workspaceId, status: { in: ["exported", "submitted", "settled"] } } }, select: { id: true, invoiceId: true, endToEndId: true, amountCents: true, status: true, mandate: { select: { mandateRef: true } } } })
  ).map((d) => ({ id: d.id, invoiceId: d.invoiceId, endToEndId: d.endToEndId, amountCents: d.amountCents, status: d.status, mandateRef: d.mandate.mandateRef }));
  const pays: MatchPayment[] = await db.payment.findMany({ where: { workspaceId, invoiceId: { not: null } }, select: { id: true, invoiceId: true, externalId: true }, orderBy: { createdAt: "desc" }, take: 5000 });
  return { invoices: minv, debits, payments: pays };
}

function returnReasonOf(remittance: string | null) {
  const code = /^\[Rückgabe ([A-Z0-9]{4})\]/.exec(remittance ?? "")?.[1];
  return code && RETURN_REASONS[code] ? code : (code ?? "MS02");
}

/** Neue/unzugeordnete Umsätze bewerten. Exakt → automatisch, sonst Vorschlag. */
export async function runMatching(workspaceId: string, txIds?: string[], actor = "system") {
  const txs = await db.bankTransaction.findMany({ where: { workspaceId, status: "unmatched", ...(txIds ? { id: { in: txIds } } : {}) }, orderBy: { bookingDate: "asc" }, take: 2000 });
  if (!txs.length) return { auto: 0, suggested: 0 };
  const ctx = await matchContext(workspaceId);
  let auto = 0;
  let suggested = 0;
  for (const t of txs) {
    const r = matchTransaction(t, ctx);
    if (r.kind === "auto") {
      try {
        await confirmMatch(workspaceId, t.id, r.invoiceId, `auto:${actor}`, { reason: r.reason, debitItemId: r.debitItemId, isReturn: r.isReturn });
        auto++;
      } catch (e) {
        log.warn("bank auto match failed", { workspaceId, error: errMessage(e) });
      }
    } else if (r.kind === "suggest") {
      await db.bankTransaction.updateMany({ where: { id: t.id, status: "unmatched" }, data: { status: "suggested", matchedInvoiceId: r.invoiceId, matchScore: r.score, matchedBy: `${SUGGEST_PREFIX}${r.reasons.join(" · ")}`.slice(0, 500) } });
      suggested++;
    }
  }
  return { auto, suggested };
}

/** Umsatz einer Rechnung zuordnen (Bestätigung durch Mensch oder exakte eigene Kennung). */
export async function confirmMatch(workspaceId: string, txId: string, invoiceId: string, actor: string, opts: { reason?: string; debitItemId?: string; isReturn?: boolean } = {}) {
  const t = await db.bankTransaction.findFirst({ where: { id: txId, workspaceId } });
  if (!t) throw new PaymentsError("Umsatz nicht gefunden.");
  if (t.status === "matched") return;
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId, kind: "INVOICE" }, select: { id: true } });
  if (!inv) throw new PaymentsError("Rechnung nicht gefunden.");

  if (t.amountCents < 0) {
    // Ausgang: nur als Rücklastschrift einer eigenen Lastschrift zulässig
    const item = opts.debitItemId
      ? await db.directDebitItem.findFirst({ where: { id: opts.debitItemId, invoiceId, batch: { workspaceId } } })
      : await db.directDebitItem.findFirst({ where: { invoiceId, status: { in: ["pending", "collected"] }, batch: { workspaceId } }, orderBy: { id: "desc" } });
    if (!item) throw new PaymentsError("Ausgänge können nur als Rücklastschrift einer eigenen Lastschrift zugeordnet werden.");
    const fee = Math.max(0, -t.amountCents - item.amountCents);
    await recordReturn(workspaceId, item.id, returnReasonOf(t.remittance), fee, actor);
    await db.bankTransaction.updateMany({ where: { id: t.id, status: { not: "matched" } }, data: { status: "matched", matchedInvoiceId: invoiceId, matchScore: 100, matchedBy: `${actor}${opts.reason ? ` – ${opts.reason}` : ""}`.slice(0, 500) } });
    await audit({ workspaceId, actor, action: "bank.return_matched", target: t.id, detail: { invoiceId, debitItemId: item.id } });
    return;
  }

  await db.$transaction(async (tx) => {
    const before = await invoiceOpenCentsTx(tx, workspaceId, invoiceId);
    const r = await tx.bankTransaction.updateMany({
      where: { id: t.id, status: { in: ["unmatched", "suggested"] } },
      data: { status: "matched", matchedInvoiceId: invoiceId, matchScore: opts.reason ? 100 : (t.matchedInvoiceId === invoiceId ? t.matchScore : null), matchedBy: `${actor}${opts.reason ? ` – ${opts.reason}` : ""}`.slice(0, 500) },
    });
    if (!r.count) return;
    await applyInvoiceEffects(tx, workspaceId, invoiceId, before.paid, { kind: "bank", bankTransactionId: t.id, actor });
  });
  await audit({ workspaceId, actor, action: "bank.matched", target: t.id, detail: { invoiceId, reason: opts.reason } });
}

async function invoiceOpenCentsTx(tx: Parameters<typeof applyInvoiceEffects>[0], workspaceId: string, invoiceId: string) {
  const [payments, bank] = await Promise.all([
    tx.payment.findMany({ where: { workspaceId, invoiceId }, select: { status: true, amountCents: true, refundedCents: true } }),
    tx.bankTransaction.findMany({ where: { workspaceId, matchedInvoiceId: invoiceId, status: "matched" }, select: { amountCents: true } }),
  ]);
  return { paid: onlineNetCents(payments) + bankNetCents(bank) };
}

export async function confirmSuggestions(workspaceId: string, txIds: string[], actor: string) {
  let ok = 0;
  const errors: string[] = [];
  for (const id of txIds.slice(0, 500)) {
    const t = await db.bankTransaction.findFirst({ where: { id, workspaceId, status: "suggested" }, select: { id: true, matchedInvoiceId: true } });
    if (!t?.matchedInvoiceId) continue;
    try {
      await confirmMatch(workspaceId, t.id, t.matchedInvoiceId, actor);
      ok++;
    } catch (e) {
      errors.push(errMessage(e));
    }
  }
  return { ok, errors };
}

export async function ignoreTransaction(workspaceId: string, txId: string, actor: string) {
  const r = await db.bankTransaction.updateMany({ where: { id: txId, workspaceId, status: { in: ["unmatched", "suggested"] } }, data: { status: "ignored", matchedInvoiceId: null, matchScore: null, matchedBy: actor } });
  if (r.count) await audit({ workspaceId, actor, action: "bank.ignored", target: txId });
}

/** Zuordnung lösen (z. B. Fehlgriff). Rechnung wird ggf. wieder offen. Rücklastschriften bleiben erfasst. */
export async function unmatchTransaction(workspaceId: string, txId: string, actor: string) {
  const t = await db.bankTransaction.findFirst({ where: { id: txId, workspaceId } });
  if (!t || !["matched", "ignored"].includes(t.status)) return;
  await db.$transaction(async (tx) => {
    const inv = t.matchedInvoiceId;
    const before = inv && t.status === "matched" ? await invoiceOpenCentsTx(tx, workspaceId, inv) : null;
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "unmatched", matchedInvoiceId: null, matchScore: null, matchedBy: null } });
    if (inv && before && t.amountCents > 0) await applyInvoiceEffects(tx, workspaceId, inv, before.paid, { kind: "bank", bankTransactionId: t.id, actor });
  });
  await audit({ workspaceId, actor, action: "bank.unmatched", target: t.id, detail: { invoiceId: t.matchedInvoiceId } });
}

export { invoiceOpenCents };

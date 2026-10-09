// DB-Integrationstest Zahlungen & Kontoabgleich (kein vitest – braucht die lokale Datenbank):
//   npx tsx --conditions=react-server --env-file=.env src/lib/payments/payments.db-check.ts
// Gegen lokale Mock-Server (keine echten Zahlungen). Legt einen eigenen Test-Sub-Account an und löscht am Ende alles.
// Prüft: Bezahllink (Wiederverwendung, parallel), Webhook → Job (Dedupe), Idempotenz (Ereignis/Aktivität genau einmal),
// Teilerstattung → Rechnung wieder offen, Revolut-Signatur, CAMT-Import (Dubletten), Vorschlag → Bestätigung, Lösen.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startMockProviders, pointConnectorsAt } from "./testing/mock-providers";

const actor = "user:payments-db-check";
const steps: string[] = [];
const ok = (s: string) => {
  steps.push(s);
  console.log(`✓ ${s}`);
};

async function main() {
  const mock = await startMockProviders();
  pointConnectorsAt(mock.url);
  process.env.PAYMENTS_MODE = "test";
  const { db } = await import("../db");
  const svc = await import("./service");
  const rec = await import("./reconcile/service");

  const agency = await db.agency.findFirstOrThrow();
  const slug = `payments-it-${Date.now().toString(36)}`;
  const ws = await db.workspace.create({ data: { agencyId: agency.id, slug, name: "Payments IT GmbH" } });
  const providerIds: string[] = [];
  try {
    const contact = await db.contact.create({ data: { workspaceId: ws.id, email: "kunde@example.invalid", firstName: "Jörg", lastName: "Müller" } });
    const inv = await db.invoice.create({ data: { workspaceId: ws.id, contactId: contact.id, kind: "INVOICE", number: "RE-PAYIT-0001", status: "SENT", grossCents: 11900, netCents: 10000, vatCents: 1900, buyerName: "Jörg Müller" } });

    // Anbieter: Live-Schlüssel im Testmodus abgelehnt; Test-Schlüssel gespeichert (verschlüsselt)
    await assert.rejects(svc.saveProvider(ws.id, { provider: "mollie", mode: "test", credentials: { apiKey: "live_mockmockmockmockmockmock01" }, methods: [], active: true, isDefault: true }, actor), /Live/);
    await assert.rejects(svc.saveProvider(ws.id, { provider: "mollie", mode: "live", credentials: { apiKey: "live_mockmockmockmockmockmock01" }, methods: [], active: true, isDefault: true }, actor), /nicht freigeschaltet/);
    const mollieId = await svc.saveProvider(ws.id, { provider: "mollie", mode: "test", credentials: { apiKey: "test_mockmockmockmockmockmock01" }, methods: ["wero", "unbekannt"], active: true, isDefault: true }, actor);
    providerIds.push(mollieId);
    const row = await db.paymentProvider.findUniqueOrThrow({ where: { id: mollieId } });
    assert.ok(!row.credentials.includes("test_mock"));
    assert.deepEqual(row.methods, ["wero"]);
    assert.match(await svc.testProvider(ws.id, "mollie", actor), /Wero/);
    ok("Mollie verbunden (Test), Schlüssel verschlüsselt, Live gesperrt, Verbindungstest");

    // Bezahllink: einmal angelegt, wiederverwendet, auch parallel
    const [l1, l2, l3] = await Promise.all([svc.ensurePaymentLink(ws.id, inv.id), svc.ensurePaymentLink(ws.id, inv.id), svc.ensurePaymentLink(ws.id, inv.id)]);
    assert.equal(new Set([l1.paymentId, l2.paymentId, l3.paymentId]).size, 1);
    assert.equal(await db.payment.count({ where: { invoiceId: inv.id } }), 1);
    const pay = await db.payment.findUniqueOrThrow({ where: { id: l1.paymentId } });
    assert.equal(pay.amountCents, 11900);
    const created = mock.state.requests.find((r) => r.path === "/mollie/payments" && r.method === "POST")!;
    assert.equal(JSON.parse(created.body).description, "Rechnung RE-PAYIT-0001");
    assert.equal(JSON.parse(created.body).metadata.invoiceId, inv.id);
    ok("Bezahllink: 3 parallele Aufrufe → 1 Zahlung (Betrag = offen, Beschreibung = Rechnungsnummer, Metadaten)");

    // Webhook: Body enthält nur die ID; zweimal → nur ein wartender Job
    const h = new Headers({ "content-type": "application/x-www-form-urlencoded" });
    assert.equal((await svc.handleWebhookRequest("mollie", mollieId, h, `id=${pay.externalId}`, "127.0.0.9")).status, 200);
    assert.equal((await svc.handleWebhookRequest("mollie", mollieId, h, `id=${pay.externalId}`, "127.0.0.9")).status, 200);
    assert.equal((await svc.handleWebhookRequest("mollie", mollieId, h, "id=evil", "127.0.0.9")).status, 400);
    assert.equal((await svc.handleWebhookRequest("mollie", "doesnotexist0000", h, `id=${pay.externalId}`, "127.0.0.9")).status, 404);
    const jobs = await db.job.findMany({ where: { type: "payments.webhook", status: "queued", payload: { equals: { providerId: mollieId, externalId: pay.externalId } } } });
    assert.equal(jobs.length, 1);
    // Noch offen beim Anbieter → keine Änderung
    await svc.processWebhookJob(jobs[0].payload as Record<string, unknown>);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "SENT");
    ok("Webhook: ungültige ID 400, fremder Anbieter 404, doppelte Meldung → 1 Job, offener Status ändert nichts");

    // Bezahlt → Rechnung PAID, Ereignis + Aktivität genau einmal (Job zweimal ausgeführt)
    Object.assign(mock.state.mollie.get(pay.externalId)!, { status: "paid", method: "wero" });
    await svc.processWebhookJob({ providerId: mollieId, externalId: pay.externalId });
    await svc.processWebhookJob({ providerId: mollieId, externalId: pay.externalId });
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "PAID");
    assert.equal(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "invoice.paid" } }), 1);
    assert.equal(await db.activity.count({ where: { workspaceId: ws.id, body: { contains: "vollständig bezahlt" } } }), 1);
    const p2 = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    assert.equal(p2.status, "paid");
    assert.equal(p2.method, "wero");
    await assert.rejects(svc.ensurePaymentLink(ws.id, inv.id), /bereits bezahlt/);
    ok("Bezahlt: Rechnung PAID, invoice.paid + Aktivität genau einmal (idempotent), kein neuer Link");

    // Teilerstattung → Rechnung wieder offen (19,00 €), neuer Link über den Restbetrag
    await assert.rejects(svc.refundPayment(ws.id, pay.id, 20000, actor), /Betrag/);
    await svc.refundPayment(ws.id, pay.id, 1900, actor);
    const p3 = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    assert.equal(p3.status, "partially_refunded");
    assert.equal(p3.refundedCents, 1900);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "SENT");
    assert.equal(await svc.invoiceOpenCents(ws.id, inv.id), 1900);
    const l4 = await svc.ensurePaymentLink(ws.id, inv.id);
    assert.notEqual(l4.paymentId, pay.id);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: l4.paymentId } })).amountCents, 1900);
    ok("Teilerstattung 19,00 €: Zahlung teilw. erstattet, Rechnung wieder offen, neuer Link über 19,00 €");

    // Restbetrag online bezahlt → PAID
    const ext4 = (await db.payment.findUniqueOrThrow({ where: { id: l4.paymentId } })).externalId;
    mock.state.mollie.get(ext4)!.status = "paid";
    await svc.syncPayment(l4.paymentId, actor);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status, "PAID");
    assert.equal(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "invoice.paid" } }), 2);
    ok("Restzahlung → Rechnung erneut PAID");

    // Revolut: Signatur
    const revId = await svc.saveProvider(ws.id, { provider: "revolut", mode: "test", credentials: { secretKey: "sk_mockmockmock01" }, methods: [], active: true, isDefault: false }, actor);
    providerIds.push(revId);
    process.env.PAYMENTS_PUBLIC_URL = "https://kundrio.example";
    assert.match(await svc.registerProviderWebhook(ws.id, "revolut", actor), /Signatur-Geheimnis übernommen/);
    delete process.env.PAYMENTS_PUBLIC_URL;
    const body = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "6516e61c-d279-a454-a837-000000000999" });
    const ts = String(Date.now());
    const sig = `v1=${createHmac("sha256", "wsk_mockSigningSecret0001").update(`v1.${ts}.${body}`).digest("hex")}`;
    assert.equal((await svc.handleWebhookRequest("revolut", revId, new Headers({ "revolut-signature": sig, "revolut-request-timestamp": ts }), body, "127.0.0.9")).status, 200);
    assert.equal((await svc.handleWebhookRequest("revolut", revId, new Headers({ "revolut-signature": "v1=00", "revolut-request-timestamp": ts }), body, "127.0.0.9")).status, 401);
    await svc.processWebhookJob({ providerId: revId, externalId: "6516e61c-d279-a454-a837-000000000999" }); // unbekannt → ignoriert
    assert.equal((await db.paymentProvider.findFirstOrThrow({ where: { workspaceId: ws.id, isDefault: true } })).provider, "mollie");
    ok("Revolut: Webhook per API eingerichtet (Geheimnis übernommen), gültige Signatur 200, falsche 401, fremde Order ignoriert");

    // Kontoabgleich: CAMT mit Überweisung zu Rechnung 2 → Vorschlag; Re-Import → Dubletten; Bestätigen → PAID; Lösen → SENT
    const inv2 = await db.invoice.create({ data: { workspaceId: ws.id, contactId: contact.id, kind: "INVOICE", number: "RE-PAYIT-0002", status: "SENT", grossCents: 5000, buyerName: "Jörg Müller" } });
    const camt = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
<Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-07</Dt></BookgDt><AcctSvcrRef>IT-${slug}-1</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>Joerg Mueller</Nm></Pty></Dbtr></RltdPties><RmtInf><Ustrd>RE PAYIT 0002</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">7.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-10-07</Dt></BookgDt><AcctSvcrRef>IT-${slug}-2</AcctSvcrRef></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const i1 = await rec.importCamt(ws.id, camt, actor);
    assert.equal(i1.inserted, 2);
    assert.equal(i1.suggested, 1);
    assert.equal(i1.auto, 0);
    const i2 = await rec.importCamt(ws.id, camt, actor);
    assert.equal(i2.inserted, 0);
    assert.equal(i2.duplicates, 2);
    const sug = await db.bankTransaction.findFirstOrThrow({ where: { workspaceId: ws.id, status: "suggested" } });
    assert.equal(sug.matchedInvoiceId, inv2.id);
    assert.match(sug.matchedBy ?? "", /Rechnungsnummer.*Betrag/);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv2.id } })).status, "SENT");
    const c = await rec.confirmSuggestions(ws.id, [sug.id], actor);
    assert.equal(c.ok, 1);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv2.id } })).status, "PAID");
    await rec.unmatchTransaction(ws.id, sug.id, actor);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: inv2.id } })).status, "SENT");
    ok("CAMT: 2 Umsätze, 1 Vorschlag (nicht automatisch), Re-Import 2 Dubletten, Bestätigen → PAID, Lösen → wieder offen");
  } finally {
    await db.job.deleteMany({ where: { type: "payments.webhook", OR: providerIds.map((id) => ({ payload: { path: ["providerId"], equals: id } })) } });
    await db.payment.deleteMany({ where: { workspaceId: ws.id } });
    await db.workspace.delete({ where: { id: ws.id } });
    await db.auditLog.deleteMany({ where: { actor: { in: [actor, "system:webhook", "system", `auto:${actor}`] }, workspaceId: null } }).catch(() => undefined);
    console.log(`Testdaten gelöscht (Sub-Account ${slug}).`);
    await mock.close();
    await db.$disconnect();
  }
  console.log(`\n${steps.length} Schritte erfolgreich.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

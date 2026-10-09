// DB-Integrationstest Abos & SEPA (kein vitest – braucht die lokale Datenbank):
//   npx tsx --conditions=react-server --env-file=.env src/lib/billing/billing.db-check.ts
// Ablauf: Abo → Abrechnungslauf → Rechnung → (versendet) → Stapel → pain.008 → Rückläufer → Mahn-Anfrage.
// Legt einen eigenen Test-Sub-Account an und löscht am Ende alle Testdaten. Versendet keine E-Mails.
import assert from "node:assert/strict";
import { db } from "../db";
import { addDays, dateOnly, isoDay } from "./periods";
import { PAIN008_NS } from "./sepa";
import { decryptIban } from "./crypto";
import {
  cancelSubscription,
  collectibleInvoices,
  createDebitBatch,
  createMandate,
  createSubscription,
  exportDebitBatch,
  markBatchSettled,
  markBatchSubmitted,
  recordReturn,
  runBilling,
  runDunning,
  saveDunningSettings,
} from "./service";
import { DEFAULT_DUNNING } from "./dunning";

const IBAN = "DE02120300000000202051";
const actor = "user:billing-db-check";
const steps: string[] = [];
const ok = (s: string) => {
  steps.push(s);
  console.log(`✓ ${s}`);
};

async function main() {
  const agency = await db.agency.findFirstOrThrow();
  const slug = `billing-it-${Date.now().toString(36)}`;
  const ws = await db.workspace.create({
    data: { agencyId: agency.id, slug, name: "Billing IT GmbH", creditorId: "DE98ZZZ09999999999", iban: "DE89370400440532013000", mailFromEmail: "it@example.invalid" },
  });
  try {
    const contact = await db.contact.create({ data: { workspaceId: ws.id, email: "kunde@example.invalid", firstName: "Jörg", lastName: "Müller" } });
    const today = dateOnly(new Date());
    const start = addDays(today, -40); // zwei fällige Monate

    // Mandat: IBAN verschlüsselt, nur letzte 4 Stellen lesbar
    const m = await createMandate(ws.id, { contactId: contact.id, accountHolder: "Jörg Müller", iban: IBAN, bic: null, scheme: "CORE", signedAt: start }, actor);
    assert.equal(m.ibanLast4, "2051");
    assert.notEqual(m.ibanEncrypted, IBAN);
    assert.ok(!m.ibanEncrypted.includes("202051"));
    assert.equal(decryptIban(m.ibanEncrypted), IBAN);
    assert.match(m.mandateRef, /^BILLINGIT/);
    ok(`Mandat ${m.mandateRef} (IBAN verschlüsselt, ···${m.ibanLast4})`);

    const sub = await createSubscription(
      ws.id,
      { contactId: contact.id, items: [{ title: "CRM Basis", qty: 1, unitCents: 10000, vatRate: 19, unit: "MON" }], interval: "monthly", startDate: start, minTermMonths: 12, noticePeriodDays: 30, paymentMethod: "sepa", mandateId: m.id, consumer: true },
      actor,
    );
    assert.equal(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "subscription.created" } }), 1);
    ok("Abo angelegt, Ereignis subscription.created");

    // Abrechnungslauf: zwei Perioden, idempotent
    const r1 = await runBilling(ws.id, today);
    assert.equal(r1.created, 2);
    const r2 = await runBilling(ws.id, today);
    assert.equal(r2.created, 0);
    const invs = await db.invoice.findMany({ where: { subscriptionId: sub.id }, orderBy: { serviceFrom: "asc" } });
    assert.equal(invs.length, 2);
    assert.equal(isoDay(invs[0].serviceFrom!), isoDay(start));
    assert.equal(isoDay(addDays(invs[0].serviceTo!, 1)), isoDay(invs[1].serviceFrom!));
    assert.ok(invs.every((i) => i.status === "DRAFT" && i.paymentMethod === "sepa" && i.grossCents === 11900));
    assert.match(invs[0].notes ?? "", /Vorabankündigung SEPA-Lastschrift.*Mandatsreferenz: .*Gläubiger-ID: DE98ZZZ09999999999/);
    assert.ok((await db.task.count({ where: { workspaceId: ws.id, title: { contains: "Abo-Rechnung prüfen" } } })) >= 2);
    ok(`Abrechnungslauf: 2 Entwürfe mit Leistungszeitraum, 2. Lauf erzeugt nichts (idempotent), Aufgaben angelegt`);

    // Entwürfe sind nicht einziehbar; „versendet“ simulieren (Vorabankündigung ist mit der Rechnung erfolgt)
    assert.equal((await collectibleInvoices(ws.id)).length, 0);
    await db.invoice.updateMany({ where: { subscriptionId: sub.id }, data: { status: "SENT", issueDate: addDays(today, -20) } });
    const col = await collectibleInvoices(ws.id);
    assert.equal(col.length, 2);
    ok("Nur versendete Rechnungen sind einziehbar");

    const batch = await createDebitBatch(ws.id, col.map((c) => c.invoice.id), actor);
    assert.equal(batch.count, 2);
    assert.equal(batch.totalCents, 23800);
    assert.ok(batch.collectionDate > today);
    assert.equal((await collectibleInvoices(ws.id)).length, 0, "im Stapel → nicht erneut einziehbar");
    ok(`Stapel ${batch.messageId}, Einzug ${isoDay(batch.collectionDate)}`);

    const { xml } = await exportDebitBatch(ws.id, batch.id, actor);
    assert.ok(xml.includes(`xmlns="${PAIN008_NS}"`));
    assert.ok(xml.includes("<SeqTp>FRST</SeqTp>"));
    assert.ok(xml.includes(`<IBAN>${IBAN}</IBAN>`));
    assert.ok(xml.includes("<CtrlSum>238.00</CtrlSum>"));
    assert.ok(xml.includes("<Nm>Joerg Mueller</Nm>"));
    const again = await exportDebitBatch(ws.id, batch.id, actor);
    assert.equal(again.xml, xml, "XML ist deterministisch");
    assert.equal((await db.directDebitBatch.findUniqueOrThrow({ where: { id: batch.id } })).status, "exported");
    ok("pain.008.001.08 erzeugt (FRST, CtrlSum, Umlaute), deterministisch");

    await markBatchSubmitted(ws.id, batch.id, actor);
    const items = await db.directDebitItem.findMany({ where: { batchId: batch.id } });
    const returned = items[0];
    await recordReturn(ws.id, returned.id, "AM04", 300, actor);
    const reopened = await db.invoice.findUniqueOrThrow({ where: { id: returned.invoiceId } });
    assert.equal(reopened.status, "SENT");
    assert.equal(reopened.paymentMethod, "transfer");
    assert.equal(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "debit.returned" } }), 1);
    await markBatchSettled(ws.id, batch.id, actor);
    const paid = await db.invoice.findUniqueOrThrow({ where: { id: items[1].invoiceId } });
    assert.equal(paid.status, "PAID");
    const mAfter = await db.sepaMandate.findUniqueOrThrow({ where: { id: m.id } });
    assert.equal(mAfter.sequence, "RCUR");
    assert.equal(mAfter.status, "active", "AM04 (Deckung) sperrt das Mandat nicht");
    ok("Eingereicht → Rücklastschrift AM04 (Rechnung wieder offen, Ereignis) → abgeschlossen (bezahlt, Mandat RCUR)");

    // Mahnwesen: Rückläufer überfällig machen → Freigabe-Anfrage (kein Versand)
    await saveDunningSettings(ws.id, DEFAULT_DUNNING);
    await db.invoice.update({ where: { id: reopened.id }, data: { dueDate: addDays(today, -10) } });
    const d1 = await runDunning(ws.id, today);
    assert.equal(d1.requested, 1);
    const d2 = await runDunning(ws.id, today);
    assert.equal(d2.requested, 0, "keine doppelte Anfrage");
    const appr = await db.approval.findFirstOrThrow({ where: { workspaceId: ws.id, kind: "dunning.send" } });
    const payload = appr.payload as { invoiceId: string; level: number; subject: string; body: string };
    assert.equal(payload.invoiceId, reopened.id);
    assert.equal(payload.level, 1);
    assert.match(payload.subject, new RegExp(reopened.number));
    assert.match(payload.body, /Jörg Müller/);
    assert.equal(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "invoice.overdue" } }), 1);
    ok("Mahnlauf: Stufe 1 als Freigabe-Anfrage (personalisiert), Ereignis invoice.overdue, keine Dublette");

    // Kündigung B2C: zum Ende der Mindestlaufzeit
    const c = await cancelSubscription(ws.id, sub.id, actor, { requestedAt: today });
    assert.equal(isoDay(c.effective!), isoDay(addDays(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 12, start.getUTCDate())), -1)));
    assert.equal(await db.crmEvent.count({ where: { workspaceId: ws.id, type: "subscription.cancelled" } }), 1);
    ok(`Kündigung (B2C) wirksam zum ${isoDay(c.effective!)}, Ereignis subscription.cancelled`);
  } finally {
    await db.approval.deleteMany({ where: { workspaceId: ws.id } });
    await db.directDebitBatch.deleteMany({ where: { workspaceId: ws.id } });
    await db.subscription.deleteMany({ where: { workspaceId: ws.id } });
    await db.sepaMandate.deleteMany({ where: { workspaceId: ws.id } });
    await db.appSetting.deleteMany({ where: { key: { startsWith: "billing:" }, OR: [{ key: `billing:dunning:${ws.id}` }, { key: { contains: ws.id } }] } });
    await db.workspace.delete({ where: { id: ws.id } });
    const left = await db.invoice.count({ where: { workspaceId: ws.id } });
    assert.equal(left, 0);
    console.log(`Testdaten gelöscht (Sub-Account ${slug}).`);
  }
  console.log(`\n${steps.length} Schritte erfolgreich.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

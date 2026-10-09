import { test, expect, SA, db, wsId, beleg, expectDenied, canRead, canEdit, hasSpecial, ROLE_KEYS } from "../helpers";
import { payToken, sealCredentials } from "../../src/lib/payments/crypto";

// (s) Zahlungen & Kontoabgleich – ohne echte Zahlungen und ohne Aufrufe externer Anbieter:
// Anbieter-Formular (Live-Schlüssel im Testbetrieb abgelehnt), öffentlicher Webhook (nur bekannte Anbieter/IDs),
// öffentliche Bezahlseite (Token), CAMT-Upload → Vorschlag mit Begründung → Sammel-Bestätigung → Rechnung bezahlt
// (Ereignis invoice.paid) → Zuordnung lösen → wieder offen; Rechte je Rolle.
const stamp = Date.now().toString(36);
const NUMBER = `RE-E2E-${stamp}`.toUpperCase();
const IBAN = `DE00E2E${stamp}`.toUpperCase();

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const ws = await wsId();
  const inv = await db().invoice.findMany({ where: { workspaceId: ws, number: { startsWith: `RE-E2E-${stamp}`.toUpperCase() } }, select: { id: true } });
  const ids = inv.map((i) => i.id);
  await db().crmEvent.deleteMany({ where: { workspaceId: ws, type: "invoice.paid", objectId: { in: ids } } });
  const txs = await db().bankTransaction.findMany({ where: { workspaceId: ws, remittance: { contains: stamp, mode: "insensitive" } }, select: { accountId: true } });
  await db().bankTransaction.deleteMany({ where: { workspaceId: ws, remittance: { contains: stamp, mode: "insensitive" } } });
  for (const a of new Set(txs.map((t) => t.accountId))) {
    if (!(await db().bankTransaction.count({ where: { accountId: a } }))) await db().bankAccount.deleteMany({ where: { id: a, source: "camt" } });
  }
  await db().invoice.deleteMany({ where: { id: { in: ids } } });
  await db().contact.deleteMany({ where: { workspaceId: ws, company: `E2E Zahlung ${stamp}` } });
});

function camt(amount: string, remittance: string, ref: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>E2E-${stamp}</MsgId></GrpHdr>
<Stmt><Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${new Date().toISOString().slice(0, 10)}</Dt></BookgDt><AcctSvcrRef>${ref}</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Zahl Kunde ${stamp}</Nm></Dbtr><DbtrAcct><Id><IBAN>DE02120300000000202051</IBAN></Id></DbtrAcct></RltdPties>
<RmtInf><Ustrd>${remittance}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
}

test("s · Anbieter verbinden: Live-Schlüssel im Testbetrieb abgelehnt, Webhook-Eingang geschützt", async ({ as, request }) => {
  const ws = await wsId();
  const p = await as("admin");
  await p.goto(`${SA}/zahlungen/anbieter`);
  await expect(p.locator("main")).toContainText("Mollie");
  await expect(p.locator("main")).toContainText("Revolut");
  await expect(p.locator("main")).toContainText("Unzer");
  await expect(p.locator("main")).toContainText("Testbetrieb");
  const before = await db().paymentProvider.count({ where: { workspaceId: ws } });
  await p.getByLabel(/API-Schlüssel/).fill("live_e2eE2Ee2eE2Ee2eE2Ee2eE2E01");
  await p.getByRole("button", { name: "Verbinden" }).first().click();
  await expect(p.getByRole("alert").filter({ hasText: "Live-Schlüssel" })).toBeVisible();
  expect(await db().paymentProvider.count({ where: { workspaceId: ws } })).toBe(before);
  beleg("Live-Schlüssel im Testmodus abgelehnt, nichts gespeichert");

  // Öffentlicher Webhook: unbekannter Anbieter/ID → 404, nichts wird eingeplant
  const jobs = await db().job.count({ where: { type: "payments.webhook" } });
  expect((await request.post("/api/payments/paypal/abcdefghij0123", { form: { id: "tr_x" } })).status()).toBe(404);
  expect((await request.post("/api/payments/mollie/abcdefghij0123", { form: { id: "tr_abcd1234" } })).status()).toBe(404);
  expect((await request.post("/api/payments/mollie/../../x", { form: { id: "tr_abcd1234" } })).status()).toBeGreaterThanOrEqual(400);
  expect(await db().job.count({ where: { type: "payments.webhook" } })).toBe(jobs);
  beleg("Webhook: unbekannte Anbieter/IDs → 404, kein Job");
});

test("s · Bezahlseite: Token geprüft, ohne Anbieter kein Bezahlversuch nach außen", async ({ page }) => {
  const ws = await wsId();
  const contact = await db().contact.create({ data: { workspaceId: ws, firstName: "Zahl", lastName: `Kunde-${stamp}`, company: `E2E Zahlung ${stamp}` } });
  const inv = await db().invoice.create({ data: { workspaceId: ws, contactId: contact.id, kind: "INVOICE", number: `${NUMBER}-P`, status: "SENT", grossCents: 4200, buyerName: `Zahl Kunde ${stamp}` } });
  await page.goto(`/zahlung/unsinn.token`);
  await expect(page.locator("main")).toContainText("Link ungültig");
  await page.goto(`/zahlung/${payToken(inv.id)}`);
  await expect(page.locator("main")).toContainText(`Rechnung ${NUMBER}-P`);
  await expect(page.locator("main")).toContainText("42,00");
  const hasProvider = (await db().paymentProvider.count({ where: { workspaceId: ws, active: true } })) > 0;
  if (!hasProvider) {
    await page.getByRole("button", { name: "Jetzt online bezahlen" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "nicht gestartet" })).toBeVisible();
    expect(await db().payment.count({ where: { invoiceId: inv.id } })).toBe(0);
    beleg("Ohne verbundenen Anbieter: verständliche Meldung, keine Zahlung angelegt");
  }
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");
});

test("s · Kontoabgleich: CAMT → Vorschlag mit Gründen → bestätigen → bezahlt → lösen", async ({ as }) => {
  const ws = await wsId();
  const contact = await db().contact.findFirstOrThrow({ where: { workspaceId: ws, company: `E2E Zahlung ${stamp}` } });
  const inv = await db().invoice.create({ data: { workspaceId: ws, contactId: contact.id, kind: "INVOICE", number: NUMBER, status: "SENT", grossCents: 12345, buyerName: `Zahl Kunde ${stamp}` } });
  const p = await as("admin");
  p.on("dialog", (d) => void d.accept());
  await p.goto(`${SA}/zahlungen/abgleich`);
  const file = { name: `auszug-${stamp}.xml`, mimeType: "application/xml", buffer: Buffer.from(camt("123.45", `Rechnung ${NUMBER.replace(/-/g, " ")} danke`, `E2E-${stamp}-1`)) };
  await p.getByLabel("Datei (XML)").setInputFiles(file);
  await p.getByRole("button", { name: "Importieren und zuordnen" }).click();
  await expect(p.getByRole("status").filter({ hasText: "camt.053.001.02" })).toContainText("1 neu");
  await expect(p.getByRole("status").filter({ hasText: "camt.053.001.02" })).toContainText("Vorschläge: 1");
  // Rechnung bleibt offen, bis ein Mensch bestätigt
  expect((await db().invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");

  // Erneuter Import → Dublette
  await p.goto(`${SA}/zahlungen/abgleich`);
  await p.getByLabel("Datei (XML)").setInputFiles(file);
  await p.getByRole("button", { name: "Importieren und zuordnen" }).click();
  await expect(p.getByRole("status").filter({ hasText: "camt.053.001.02" })).toContainText("0 neu (1 bereits vorhanden)");

  await p.goto(`${SA}/zahlungen/abgleich`);
  await expect(p.locator("main")).toContainText(`Rechnungsnummer ${NUMBER} im Verwendungszweck`);
  await expect(p.locator("main")).toContainText("Betrag entspricht dem offenen Betrag");
  await p.getByRole("checkbox", { name: /Vorschlag 123,45/ }).check();
  await p.getByRole("button", { name: "Ausgewählte bestätigen" }).click();
  await expect(p.getByRole("status").filter({ hasText: "bestätigt" })).toBeVisible();
  expect((await db().invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
  expect(await db().crmEvent.count({ where: { workspaceId: ws, type: "invoice.paid", objectId: inv.id } })).toBe(1);
  beleg(`CAMT-Vorschlag bestätigt → ${NUMBER} bezahlt, invoice.paid`);

  await p.goto(`${SA}/zahlungen/abgleich`);
  const row = p.locator("tr", { hasText: `Zahl Kunde ${stamp}` }).filter({ has: p.getByRole("button", { name: "Lösen" }) });
  await row.getByRole("button", { name: "Lösen" }).click();
  await expect(p.getByRole("status").filter({ hasText: "gelöst" })).toBeVisible();
  expect((await db().invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SENT");
  beleg("Zuordnung gelöst → Rechnung wieder offen");
});

test("s · Rechte: Zahlungen nur mit Leserecht auf Rechnungen, Erstatten nur mit Freigaberecht", async ({ as }) => {
  for (const role of ROLE_KEYS) {
    if (canRead(role, "invoices")) continue;
    const p = await as(role);
    await expectDenied(p, `${SA}/zahlungen`);
  }
  // Ohne Bearbeitungsrecht keine Import-/Bestätigungs-Formulare
  const ro = ROLE_KEYS.find((r) => canRead(r, "invoices") && !canEdit(r, "invoices"));
  if (ro) {
    const p = await as(ro);
    await p.goto(`${SA}/zahlungen/abgleich`);
    await expect(p.locator("main")).not.toContainText("Importieren und zuordnen");
  }
  expect(hasSpecial("admin", "approve")).toBe(true);
});

test("s · Bezahllink auf Rechnung und im Mailtext, Rechte-Hinweis, manuell bezahlt → invoice.paid genau einmal", async ({ as }) => {
  const ws = await wsId();
  const contact = await db().contact.findFirstOrThrow({ where: { workspaceId: ws, company: `E2E Zahlung ${stamp}` } });
  const inv = await db().invoice.create({ data: { workspaceId: ws, contactId: contact.id, kind: "INVOICE", number: `${NUMBER}-L`, status: "SENT", grossCents: 9900, buyerName: `Zahl Kunde ${stamp}`, buyerEmail: `zahl-${stamp}@example.org`, dueDate: new Date(Date.now() + 14 * 864e5) } });
  // Testanbieter nur in der DB (keine Außenwirkung: der Link führt auf die eigene Bezahlseite, die Zahlung entsteht erst dort)
  const existing = await db().paymentProvider.findFirst({ where: { workspaceId: ws } });
  const prov = existing ?? (await db().paymentProvider.create({ data: { workspaceId: ws, provider: "mollie", mode: "test", credentials: sealCredentials({ apiKey: "test_e2eE2Ee2eE2Ee2eE2Ee2eE2Ee2e" }), methods: ["wero", "creditcard"], isDefault: true } }));
  try {
    const p = await as("admin");
    await p.goto(`${SA}/rechnungen/${inv.id}`);
    const pay = p.getByRole("link", { name: "Online bezahlen" });
    expect(await pay.getAttribute("href")).toMatch(new RegExp(`/zahlung/${payToken(inv.id).replace(/\./g, "\\.")}$`));
    await expect(p.getByRole("button", { name: "Bezahllink kopieren" })).toBeVisible();
    await expect(p.locator("#send-body")).toHaveValue(/online bezahlen: http.*\/zahlung\//);
    expect(await db().payment.count({ where: { invoiceId: inv.id } })).toBe(0);
    beleg("Rechnung: „Online bezahlen“ + Link im Standard-Mailtext, ohne Zahlung beim Anbieter anzulegen");

    // Manuell als bezahlt markieren → Ereignis invoice.paid (via manual), zweites Setzen ändert nichts
    await p.getByLabel("Status ändern").selectOption("PAID");
    await p.getByRole("button", { name: "Setzen" }).click();
    await expect.poll(async () => (await db().invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await p.goto(`${SA}/rechnungen/${inv.id}`);
    await expect(p.getByRole("link", { name: "Online bezahlen" })).toHaveCount(0);
    await p.getByLabel("Status ändern").selectOption("PAID");
    await p.getByRole("button", { name: "Setzen" }).click();
    await p.waitForLoadState("networkidle");
    const ev = await db().crmEvent.findMany({ where: { workspaceId: ws, type: "invoice.paid", objectId: inv.id } });
    expect(ev).toHaveLength(1);
    expect((ev[0].data as Record<string, unknown>).via).toBe("manual");
    beleg("Manuell bezahlt → invoice.paid (via manual) genau einmal, Bezahl-Button verschwindet");

    // Rechte-Hinweis: Buchhaltung bearbeitet Rechnungen, darf aber keine Anbieter verbinden
    const b = await as("buchhaltung");
    await b.goto(`${SA}/zahlungen/anbieter`);
    await expect(b.locator("main")).toContainText("Wer darf Zahlungsanbieter verbinden");
    await expect(b.locator("main")).toContainText("Ihnen fehlt mindestens eines dieser Rechte");
    await expect(b.getByRole("button", { name: "Verbinden" })).toHaveCount(0);
  } finally {
    if (!existing) await db().paymentProvider.delete({ where: { id: prov.id } });
  }
});

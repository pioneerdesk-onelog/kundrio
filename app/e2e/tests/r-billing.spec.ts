import { test, expect, SA, db, wsId, beleg, mailpitSearch, waitFor, expectDenied, canRead, hasSpecial } from "../helpers";
import { portalToken } from "../../src/lib/billing/crypto";

// (r) Abos & SEPA: Produkt → Mandat → Abo → Abrechnungslauf (Entwurf) → Lastschrift-Stapel → pain.008 → eingereicht →
// Rücklastschrift → Mahnung als Freigabe → Kundenportal mit Kündigungsbutton (§ 312k) und Eingangsbestätigung; Rechte.
const stamp = Date.now().toString(36);
const IBAN = "DE02120300000000202051";
const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const ws = await wsId();
  const subs = await db().subscription.findMany({ where: { workspaceId: ws, contact: { company: `E2E Abo ${stamp}` } }, select: { id: true } });
  const invIds = (await db().invoice.findMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } }, select: { id: true } })).map((i) => i.id);
  if (invIds.length) await db().approval.deleteMany({ where: { workspaceId: ws, kind: "dunning.send", OR: invIds.map((id) => ({ payload: { path: ["invoiceId"], equals: id } })) } });
  const batches = await db().directDebitItem.findMany({ where: { invoiceId: { in: invIds } }, select: { batchId: true } });
  await db().directDebitBatch.deleteMany({ where: { id: { in: batches.map((b) => b.batchId) } } });
  await db().invoice.deleteMany({ where: { id: { in: invIds } } });
  await db().subscription.deleteMany({ where: { id: { in: subs.map((s) => s.id) } } });
  await db().sepaMandate.deleteMany({ where: { workspaceId: ws, contact: { company: `E2E Abo ${stamp}` } } });
  await db().product.deleteMany({ where: { workspaceId: ws, name: `E2E-Paket ${stamp}` } });
  await db().contact.deleteMany({ where: { workspaceId: ws, company: `E2E Abo ${stamp}` } });
});

test("r · Abo mit SEPA: Katalog, Mandat, Abo, Abrechnung, Stapel, pain.008, Rückläufer, Mahnung", async ({ as }) => {
  const ws = await wsId();
  const w = await db().workspace.findUniqueOrThrow({ where: { id: ws } });
  // Voraussetzung Lastschrift: Gläubiger-ID (Bundesbank-Beispiel) und eigene IBAN
  if (!w.creditorId || !w.iban) await db().workspace.update({ where: { id: ws }, data: { creditorId: w.creditorId ?? "DE98ZZZ09999999999", iban: w.iban ?? "DE89370400440532013000" } });
  const contact = await db().contact.create({ data: { workspaceId: ws, email: `abo-${stamp}@kunde.example`, firstName: "Jörg", lastName: `Abo-${stamp}`, company: `E2E Abo ${stamp}` } });

  const p = await as("admin");
  // Produktkatalog
  await p.goto(`${SA}/abos/produkte`);
  await p.getByLabel("Name").first().fill(`E2E-Paket ${stamp}`);
  await p.getByLabel("Preis netto (€)").first().fill("49,00");
  await p.getByRole("button", { name: "Produkt anlegen" }).click();
  await expect(p.getByRole("status")).toContainText("Gespeichert");
  await expect(p.locator("main")).toContainText(`E2E-Paket ${stamp}`);

  // Mandat: ungültige IBAN abgelehnt, gültige verschlüsselt gespeichert
  await p.goto(`${SA}/abos/mandate`);
  await p.getByLabel("Kontakt", { exact: true }).selectOption(contact.id);
  await p.getByLabel("Kontoinhaber").fill("Jörg Abo");
  await p.getByLabel("IBAN").fill("DE00 1203 0000 0000 2020 51");
  await p.getByRole("button", { name: "Mandat anlegen" }).click();
  // Next.js hat einen eigenen (leeren) role=alert für Seitenwechsel → nach Text filtern
  await expect(p.getByRole("alert").filter({ hasText: "IBAN ist ungültig" })).toBeVisible();
  await p.getByLabel("IBAN").fill(IBAN);
  await p.getByLabel("Unterschrieben am").fill(day(-60));
  await p.getByRole("button", { name: "Mandat anlegen" }).click();
  await expect(p.getByRole("status")).toContainText("Mandat");
  const mandate = await db().sepaMandate.findFirstOrThrow({ where: { workspaceId: ws, contactId: contact.id } });
  expect(mandate.ibanLast4).toBe("2051");
  expect(mandate.ibanEncrypted).not.toContain("202051");
  await expect(p.locator("main")).toContainText("···2051");
  await expect(p.locator("main")).not.toContainText(IBAN);
  const pdf = await p.request.get(`${SA}/abos/mandate/${mandate.id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // Abo anlegen (Start vor 40 Tagen → zwei fällige Monate)
  await p.goto(`${SA}/abos/neu`);
  const product = await db().product.findFirstOrThrow({ where: { workspaceId: ws, name: `E2E-Paket ${stamp}` } });
  await p.getByLabel("Kunde (Kontakt)").selectOption(contact.id);
  await p.getByLabel("Produkt hinzufügen").selectOption(product.id);
  await p.getByLabel("Beginn (erste Abrechnung)").fill(day(-40));
  await p.getByLabel("Verbraucher (B2C)").check();
  await p.getByLabel("Zahlungsweg").selectOption("sepa");
  await p.getByLabel("Mandat", { exact: true }).selectOption(mandate.id);
  await p.getByRole("button", { name: "Abo anlegen" }).click();
  await p.waitForURL(/\/abos\/[a-z0-9]{20,}$/); // Abo-ID (cuid), nicht /abos/neu
  const sub = await db().subscription.findFirstOrThrow({ where: { workspaceId: ws, contactId: contact.id } });
  expect(sub.paymentMethod).toBe("sepa");
  expect(await db().crmEvent.count({ where: { workspaceId: ws, type: "subscription.created", data: { path: ["subscriptionId"], equals: sub.id } } })).toBe(1);

  // Abrechnungslauf: Entwürfe mit Leistungszeitraum, idempotent
  await p.goto(`${SA}/abos`);
  await p.getByRole("button", { name: "Jetzt abrechnen" }).click();
  await expect(p.getByRole("status")).toContainText("Rechnung(en) als Entwurf");
  await p.getByRole("button", { name: "Jetzt abrechnen" }).click();
  await expect(p.getByRole("status")).toContainText(/Keine fälligen|als Entwurf/);
  const invs = await db().invoice.findMany({ where: { subscriptionId: sub.id }, orderBy: { serviceFrom: "asc" } });
  expect(invs).toHaveLength(2);
  expect(invs.every((i) => i.status === "DRAFT" && i.serviceFrom && i.serviceTo)).toBe(true);
  expect(invs[0].notes).toContain("Vorabankündigung");
  beleg(`Abo-Rechnungen ${invs.map((i) => i.number).join(", ")} als Entwurf`);

  // Versand der Rechnungen (Vorabankündigung) wird hier direkt gesetzt – der Belegversand ist in (i) getestet
  await db().invoice.updateMany({ where: { subscriptionId: sub.id }, data: { status: "SENT", issueDate: new Date(Date.now() - 20 * 864e5) } });
  await p.goto(`${SA}/abos/lastschrift`);
  for (const i of invs) await expect(p.getByLabel(`Rechnung ${i.number} einziehen`)).toBeChecked();
  await p.getByRole("button", { name: "Stapel erstellen" }).click();
  await p.waitForURL(/\/abos\/lastschrift\/[a-z0-9]+$/);
  const batchId = p.url().split("/").pop()!;
  const xmlRes = await p.request.get(`${SA}/abos/lastschrift/${batchId}/xml`);
  expect(xmlRes.status()).toBe(200);
  const xml = await xmlRes.text();
  expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08"');
  expect(xml).toContain("<SeqTp>FRST</SeqTp>");
  expect(xml).toContain(`<IBAN>${IBAN}</IBAN>`);
  expect(xml).toContain(`<CtrlSum>${((invs[0].grossCents + invs[1].grossCents) / 100).toFixed(2)}</CtrlSum>`);
  beleg(`pain.008 Stapel ${batchId}: ${xml.length} Bytes`);

  await p.reload();
  if (hasSpecial("admin", "approve")) {
    p.once("dialog", (d) => d.accept());
    await p.getByRole("button", { name: "Bei der Bank eingereicht" }).click();
    await expect(p.getByRole("status")).toContainText("eingereicht");
  } else {
    await db().directDebitBatch.update({ where: { id: batchId }, data: { status: "submitted" } });
    await p.reload();
  }

  // Rücklastschrift erfassen → Rechnung wieder offen, Ereignis
  await p.getByText("Erfassen", { exact: true }).first().click();
  await p.getByLabel("Rückgabegrund").first().selectOption("AM04");
  await p.getByRole("button", { name: "Rücklastschrift erfassen" }).first().click();
  await expect(p.getByRole("status").filter({ hasText: "wieder offen" }).first()).toBeVisible();
  const ret = await db().directDebitItem.findFirstOrThrow({ where: { batchId, status: "returned" } });
  const reopened = await db().invoice.findUniqueOrThrow({ where: { id: ret.invoiceId } });
  expect(reopened.status).toBe("SENT");
  expect(await db().crmEvent.count({ where: { workspaceId: ws, type: "debit.returned", data: { path: ["invoiceId"], equals: reopened.id } } })).toBe(1);
  // Standard-Prozess „Rücklastschrift → Aufgabe + interne Info“ (aktiv, ohne Außenwirkung) reagiert auf das Ereignis
  if (await db().process.findFirst({ where: { workspaceId: ws, templateKey: "ruecklastschrift", status: "ACTIVE" } })) {
    const task = await waitFor(() => db().task.findFirst({ where: { workspaceId: ws, contactId: reopened.contactId, title: { startsWith: "Rücklastschrift klären" } } }));
    beleg(`Prozess Rücklastschrift → Aufgabe ${task.id}`);
    await db().task.deleteMany({ where: { id: task.id } });
  }

  // Mahnung: überfällig → nur Freigabe-Anfrage, kein Versand
  await db().invoice.update({ where: { id: reopened.id }, data: { dueDate: new Date(Date.now() - 10 * 864e5) } });
  await p.goto(`${SA}/abos/mahnwesen`);
  await p.getByRole("button", { name: "Zahlungserinnerung anfragen" }).first().click();
  const appr = await waitFor(() => db().approval.findFirst({ where: { workspaceId: ws, kind: "dunning.send", status: "pending", payload: { path: ["invoiceId"], equals: reopened.id } } }));
  expect((appr.payload as { subject: string }).subject).toContain(reopened.number);
  expect((await mailpitSearch(`Zahlungserinnerung zu Rechnung ${reopened.number}`)).length).toBe(0);
  await p.reload();
  await expect(p.locator("main")).toContainText("wartet auf Freigabe");
});

test("r · Kundenportal: Rechnungen, Kündigungsbutton in zwei Stufen, Eingangsbestätigung per E-Mail", async ({ browser }) => {
  test.skip(!process.env.APP_SECRET, "APP_SECRET nicht gesetzt");
  const ws = await wsId();
  const contact = await db().contact.findFirstOrThrow({ where: { workspaceId: ws, company: `E2E Abo ${stamp}` } });
  const sub = await db().subscription.findFirstOrThrow({ where: { contactId: contact.id } });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`/kundenportal/${portalToken(contact.id)}`);
  await expect(p.getByRole("heading", { name: "Ihr Kundenportal" })).toBeVisible();
  await expect(p.getByRole("link", { name: "PDF" }).first()).toBeVisible();
  const pdf = await p.request.get((await p.getByRole("link", { name: "PDF" }).first().getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // Stufe 1: Kündigungsschaltfläche, Stufe 2: Bestätigungsseite mit „Jetzt kündigen“
  await p.getByRole("link", { name: "Vertrag hier kündigen" }).click();
  await expect(p.getByRole("heading", { name: "Kündigung bestätigen" })).toBeVisible();
  await p.getByLabel("E-Mail für die Bestätigung").fill(contact.email!);
  await p.getByRole("button", { name: "Jetzt kündigen" }).click();
  await expect(p.getByRole("status")).toContainText("Ihre Kündigung ist eingegangen");
  const after = await db().subscription.findUniqueOrThrow({ where: { id: sub.id } });
  expect(after.status).toBe("cancelled");
  expect(after.endDate).not.toBeNull();
  const mails = await waitFor(async () => {
    const m = await mailpitSearch(`Eingangsbestätigung Ihrer Kündigung`);
    return m.find((x: { To: { Address: string }[] }) => x.To[0]?.Address === contact.email) ?? null;
  });
  expect(mails).toBeTruthy();
  beleg(`Kündigung über Portal: Abo ${sub.id} endet ${after.endDate?.toISOString().slice(0, 10)}`);

  // Manipulierter Link → kein Zugriff
  await p.goto(`/kundenportal/${portalToken(contact.id)}x`);
  await expect(p.getByRole("heading", { name: "Link ungültig" })).toBeVisible();
  await ctx.close();
});

test("r · Rechte: Leserecht ohne Anlegen, ohne Rechnungsrecht kein Zugriff", async ({ as }) => {
  for (const role of ["vertrieb-a", "marketing"] as const) {
    const p = await as(role);
    if (!canRead(role, "invoices")) {
      await expectDenied(p, `${SA}/abos`);
      continue;
    }
    await p.goto(`${SA}/abos`);
    await expect(p.getByRole("heading", { name: "Abos" })).toBeVisible();
    await expect(p.getByRole("link", { name: "Neues Abo" })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Jetzt abrechnen" })).toHaveCount(0);
  }
});

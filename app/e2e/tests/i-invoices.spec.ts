import { createHmac } from "node:crypto";
import { test, expect, SA, db, wsId, beleg, mailpitSearch, waitFor } from "../helpers";

// (i) Angebote & Rechnungen: Liste, Druckansicht mit GiroCode, XRechnung
test("i · Rechnung: Druckansicht mit GiroCode, XRechnung wohlgeformt mit korrekten Summen", async ({ as }) => {
  const ws = await wsId();
  const inv = await db().invoice.findFirstOrThrow({ where: { workspaceId: ws, number: "RE-2026-9001" } });
  const p = await as("buchhaltung");
  await p.goto(`${SA}/rechnungen`);
  await expect(p.locator("main")).toContainText("RE-2026-9001");
  await p.goto(`${SA}/rechnungen/${inv.id}/druck`);
  await expect(p.locator("body")).toContainText("DE123456789");
  await expect(p.locator('img[alt*="GiroCode" i], img[alt*="QR" i], svg').first()).toBeVisible();
  const x = await p.request.get(`${SA}/rechnungen/${inv.id}/xrechnung`);
  expect(x.status()).toBe(200);
  const xml = await x.text();
  expect(xml).toContain("xrechnung_3.0");
  expect(xml).toContain(`<cbc:PayableAmount currencyID="EUR">${(inv.grossCents / 100).toFixed(2)}`);
  expect(xml).toContain("E2E-REF-0001");
  beleg(`XRechnung ${inv.number}: ${(inv.grossCents / 100).toFixed(2)} EUR`);
});

test("i · Vertrieb darf Rechnungen lesen, aber nicht anlegen", async ({ as }) => {
  const p = await as("vertrieb-a");
  await p.goto(`${SA}/rechnungen`);
  await expect(p.getByRole("link", { name: /Neue Rechnung|Neues Angebot|Anlegen/ })).toHaveCount(0);
});

// ---------- Auftragsbestätigung & personalisierbare Texte ----------

async function freshQuote(number: string) {
  const ws = await wsId();
  const contact = await db().contact.findFirst({ where: { workspaceId: ws, email: { contains: "example" } }, orderBy: { createdAt: "asc" } });
  return db().invoice.create({
    data: {
      workspaceId: ws, kind: "QUOTE", number, contactId: contact?.id ?? null, issueDate: new Date(), dueDate: new Date(Date.now() + 14 * 864e5),
      items: [{ title: "Workshop KI im Mittelstand", qty: 2, unitCents: 120000, vatRate: 19, unit: "DAY" }], netCents: 240000, vatCents: 45600, grossCents: 285600,
      buyerName: contact?.company ?? "Testkunde GmbH", buyerAddress: "Hauptstr. 1\n80331 München", buyerEmail: contact?.email ?? "kunde@example.com",
      serviceFrom: new Date(Date.now() + 20 * 864e5), serviceTo: new Date(Date.now() + 21 * 864e5),
    },
  });
}

async function cleanupChain(quoteId: string) {
  const ws = await wsId();
  const ids = (await db().invoice.findMany({ where: { workspaceId: ws, OR: [{ id: quoteId }, { fromQuoteId: quoteId }] }, select: { id: true } })).map((x) => x.id);
  await db().invoice.deleteMany({ where: { workspaceId: ws, OR: [{ fromOrderId: { in: ids } }, { id: { in: ids } }] } });
}

test("i · Angebot → Auftragsbestätigung (mit Kundenreferenz) → E-Mail mit PDF → Rechnung", async ({ as }) => {
  const q = await freshQuote(`AN-2026-${String(8000 + Math.floor(Math.random() * 999)).padStart(4, "0")}`);
  try {
    const p = await as("admin");
    await p.goto(`${SA}/rechnungen/${q.id}`);
    await p.getByLabel(/Bestellnummer des Kunden/).fill("PO-E2E-77");
    await p.getByRole("button", { name: "Auftragsbestätigung erstellen" }).click();
    await expect(p.getByRole("heading", { level: 1 })).toContainText(/Auftragsbestätigung AB-\d{4}-\d{4}/);
    const order = await db().invoice.findFirstOrThrow({ where: { fromQuoteId: q.id, kind: "ORDER" } });
    expect(order.customerOrderRef).toBe("PO-E2E-77");
    expect((await db().invoice.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("ACCEPTED");
    await expect(p.getByRole("heading", { name: "Belegkette" })).toBeVisible();
    beleg(`Auftragsbestätigung ${order.number} aus ${q.number}`);

    // PDF abrufbar
    const pdf = await p.request.get(`${SA}/rechnungen/${order.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

    // E-Mail mit PDF (Mailpit, capture)
    const subject = await p.getByLabel("Betreff").inputValue();
    expect(subject).toContain(order.number);
    await p.getByRole("button", { name: /Per E-Mail senden|Versand zur Freigabe/ }).click();
    await expect(p.getByRole("status").filter({ hasText: /Gesendet|Freigabe angefragt/ })).toBeVisible();
    const msgs = await waitFor(async () => {
      const m = await mailpitSearch(`subject:"${order.number}"`);
      return m.length ? m : null;
    }, 20_000);
    const full = (await (await fetch(`${process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:58025"}/api/v1/message/${msgs[0].ID}`)).json()) as { Attachments?: { ContentType: string; FileName: string }[] };
    expect(full.Attachments?.some((a) => a.ContentType === "application/pdf")).toBe(true);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SENT");
    beleg(`Versand ${order.number} mit PDF ${full.Attachments?.[0]?.FileName}`);

    // AB → Rechnung
    await p.reload();
    await p.getByRole("button", { name: "In Rechnung umwandeln" }).click();
    await expect(p.getByRole("heading", { level: 1 })).toContainText(/Rechnung RE-\d{4}-\d{4}/);
    const inv = await db().invoice.findFirstOrThrow({ where: { fromOrderId: order.id, kind: "INVOICE" } });
    expect(inv.customerOrderRef).toBe("PO-E2E-77");
    await expect(p.locator("main")).toContainText(order.number);
    // Ereignisse in der Outbox
    const types = (await db().crmEvent.findMany({ where: { objectId: { in: [q.id, order.id] } }, select: { type: true } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["quote.accepted", "order.created", "invoice.sent"]));
  } finally {
    await cleanupChain(q.id);
  }
});

test("i · Texte & Vorlagen: Admin passt AB-Einleitung mit Platzhalter an, Buchhaltung nur Ansicht", async ({ as }) => {
  const ws = await wsId();
  const before = (await db().workspace.findUniqueOrThrow({ where: { id: ws } })).documentTexts;
  try {
    const p = await as("admin");
    await p.goto(`${SA}/rechnungen/texte?art=ORDER`);
    const intro = p.getByLabel(/Einleitung/);
    await intro.fill("Danke für Ihren Auftrag, ");
    await intro.click();
    await intro.press("End");
    await p.getByRole("button", { name: "Ansprechpartner (Vor- und Nachname)" }).first().click();
    await expect(intro).toHaveValue(/\{\{ kunde\.ansprechpartner \}\}/);
    await p.getByRole("button", { name: /Texte für „Auftragsbestätigung“ speichern/ }).click();
    await expect(p.getByRole("status").filter({ hasText: "gespeichert" })).toBeVisible();
    const saved = (await db().workspace.findUniqueOrThrow({ where: { id: ws } })).documentTexts as { ORDER?: { intro?: string } };
    expect(saved.ORDER?.intro).toContain("{{ kunde.ansprechpartner }}");
    // Unbekannter Platzhalter wird abgelehnt (Knopf gesperrt)
    await intro.fill("Hallo {{ kunde.iban }}");
    await expect(p.getByRole("alert").filter({ hasText: "Unbekannte Platzhalter" })).toBeVisible();

    const b = await as("buchhaltung");
    await b.goto(`${SA}/rechnungen/texte?art=ORDER`);
    await expect(b.locator("main")).toContainText("Ansicht: Standardtexte ändern dürfen");
    await expect(b.getByRole("button", { name: /speichern/ })).toHaveCount(0);
  } finally {
    await db().workspace.update({ where: { id: ws }, data: { documentTexts: before ?? {} } });
  }
});

test("i · Kunde nimmt Angebot über signierten Link online an", async ({ page }) => {
  const secret = process.env.APP_SECRET;
  test.skip(!secret, "APP_SECRET nicht gesetzt");
  const q = await freshQuote(`AN-2026-${String(9100 + Math.floor(Math.random() * 800)).padStart(4, "0")}`);
  try {
    const exp = Date.now() + 5 * 864e5;
    const sig = createHmac("sha256", secret!).update(`doc-accept:${q.id}:${exp}`).digest("base64url");
    await page.goto(`/dokument/${q.id}.${exp}.${sig}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(q.number);
    await page.getByLabel(/Bestellnummer/).fill("KUNDE-123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Angebot verbindlich annehmen" }).click();
    await expect(page.getByRole("status")).toContainText("angenommen");
    const after = await db().invoice.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("ACCEPTED");
    expect(after.customerOrderRef).toBe("KUNDE-123");
    // manipulierter Link
    await page.goto(`/dokument/${q.id}.${exp + 1}.${sig}`);
    await expect(page.locator("body")).toContainText("Angebot nicht verfügbar");
  } finally {
    await cleanupChain(q.id);
  }
});

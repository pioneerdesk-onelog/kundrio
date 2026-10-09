import { test, expect, SA, SLUG, db, wsId, beleg, waitFor, mailpitSearch, mailpitBody } from "../helpers";

// (p) Öffentlicher Buchungskalender: Vorlage freischalten → Gast bucht → Bestätigung + Mail → umbuchen → absagen.
const stamp = Date.now().toString(36);
const name = `E2E-Buchung ${stamp}`;
const bookingSlug = `e2e-buchung-${stamp}`;

test.describe.configure({ mode: "serial" });

let manageUrl = "";

test("p · Online-Buchung in der Terminvorlage freischalten", async ({ as }) => {
  const ws = await wsId();
  const mt = await db().meetingType.create({ data: { workspaceId: ws, name, titleTemplate: `${name} mit {{ contact.FIRSTNAME }}`, durationMin: 30, videoProvider: "jitsi" } });
  const p = await as("admin");
  await p.goto(`${SA}/kalender/vorlagen?id=${mt.id}`);
  await expect(p.getByRole("heading", { name: `Online-Buchung: ${name}` })).toBeVisible();
  await p.getByLabel("Öffentlich buchbar").check();
  await p.getByLabel("Adresse der Buchungsseite").fill(bookingSlug);
  // alle Tage ganztägig, damit der Test unabhängig vom Wochentag ist
  for (const d of ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]) {
    await p.getByRole("checkbox", { name: d, exact: true }).check();
    await p.getByLabel(`Zeiten ${d}`).fill("08:00-18:00");
  }
  await p.getByLabel("An bundesweiten Feiertagen nicht buchbar").uncheck();
  await p.getByLabel("Vorlauf (Stunden)").fill("2");
  await p.getByLabel("Frage 1", { exact: true }).fill("Worum geht es?");
  await p.getByRole("button", { name: "Buchung speichern" }).click();
  await expect(p.getByText("Gespeichert – öffentlich buchbar.")).toBeVisible();
  const saved = await waitFor(() => db().meetingType.findFirst({ where: { id: mt.id, bookingEnabled: true } }));
  expect(saved.bookingSlug).toBe(bookingSlug);
  await expect(p.locator("main")).toContainText(`/buchen/${SLUG}/${bookingSlug}`);
  await expect(p.locator("textarea[readonly]")).toHaveValue(/<iframe src=".*\?einbettung=1"/);
});

test("p · Gast bucht öffentlich → Bestätigungsseite, Kontakt, Ereignis, Mail", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } }); // ohne Login
  const p = await ctx.newPage();
  await p.goto(`/buchen/${SLUG}/${bookingSlug}`);
  await expect(p.getByRole("heading", { name })).toBeVisible();
  await expect(p.locator("main")).toContainText("Zeiten in Ihrer Zeitzone");
  await p.getByRole("group", { name: "1. Tag wählen" }).getByRole("button").nth(1).click();
  await p.getByRole("group", { name: "2. Uhrzeit wählen" }).getByRole("button").first().click();
  const email = `gast-${stamp}@example.org`;
  await p.getByLabel("Vorname *").fill("Greta");
  await p.getByLabel("Nachname *").fill("Gast");
  await p.getByLabel("E-Mail *").fill(email);
  await p.getByLabel(/Worum geht es\?/).fill("Beratung {{ owner.email }}");
  await p.getByRole("checkbox", { name: /Angaben zur Vereinbarung/ }).check();
  await p.getByRole("button", { name: "Verbindlich buchen" }).click();
  await p.waitForURL(/\/buchen\/termin\/[A-Za-z0-9_-]{43}\?neu=1/, { timeout: 30_000 });
  manageUrl = p.url().split("?")[0];
  await expect(p.getByRole("status").first()).toContainText("Ihr Termin ist gebucht");

  const ws = await wsId();
  const contact = await waitFor(() => db().contact.findFirst({ where: { workspaceId: ws, email } }));
  const ev = await waitFor(() => db().event.findFirst({ where: { workspaceId: ws, source: "booking", status: "scheduled", contactId: contact.id } }));
  expect(ev.bookingTokenHash).toMatch(/^[0-9a-f]{64}$/);
  expect(manageUrl).not.toContain(ev.bookingTokenHash!);
  expect(ev.description).not.toContain("{{");
  expect(await db().crmEvent.count({ where: { workspaceId: ws, type: "meeting.booked", objectId: contact.id } })).toBe(1);
  const mails = await waitFor(async () => {
    const m = await mailpitSearch(`to:${email} subject:"Termin bestätigt: ${name}"`);
    return m.length ? m : null;
  });
  const body = await mailpitBody(mails[0].ID);
  expect(JSON.stringify(body)).toContain("/buchen/termin/");
  const ics = await p.request.get(`${manageUrl}/ics`);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  beleg(`Buchung ${ev.id} für ${contact.id}`);
  await ctx.close();
});

test("p · Gast verschiebt und sagt ab", async ({ browser }) => {
  expect(manageUrl).not.toBe("");
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await ctx.newPage();
  await p.goto(`${manageUrl}?aktion=verschieben`);
  await p.getByRole("group", { name: "1. Tag wählen" }).getByRole("button").nth(2).click();
  await p.getByRole("group", { name: "2. Uhrzeit wählen" }).getByRole("button").first().click();
  await p.getByRole("button", { name: "Auf diese Zeit verschieben" }).click();
  await expect(p.getByRole("status").first()).toContainText("verschoben", { timeout: 30_000 });

  await p.getByLabel("Grund (optional)").fill("Krank");
  await p.getByRole("button", { name: "Termin absagen" }).click();
  await expect(p.getByRole("status").first()).toContainText("abgesagt", { timeout: 30_000 });
  const ws = await wsId();
  await waitFor(() => db().event.findFirst({ where: { workspaceId: ws, source: "booking", status: "cancelled", title: { startsWith: name } } }));
  // Verwaltungslink darf nicht eingebettet werden, die Buchungsseite schon
  expect((await p.request.get(manageUrl)).headers()["x-frame-options"]).toBe("DENY");
  expect((await p.request.get(`/buchen/${SLUG}/${bookingSlug}`)).headers()["x-frame-options"]).toBeUndefined();
  await ctx.close();
});

test("p · Unbekannte Buchungsseite und kaputter Link → 404", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await ctx.newPage();
  expect((await p.goto(`/buchen/${SLUG}/gibt-es-nicht-${stamp}`))!.status()).toBe(404);
  expect((await p.goto(`/buchen/termin/${"x".repeat(43)}`))!.status()).toBe(404);
  await ctx.close();
});

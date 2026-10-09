import { test, expect, SA, db, wsId, beleg, waitFor, mailpitSearch, MAILPIT } from "../helpers";

// (o) Termine mit Video-Call: Terminvorlage pflegen, Termin mit Jitsi-Fallback (.ics per Mail) anlegen, absagen.
const stamp = Date.now().toString(36);

test("o · Terminvorlage anlegen mit Platzhaltern und Vorschau", async ({ as }) => {
  const p = await as("admin");
  await p.goto(`${SA}/kalender/vorlagen`);
  await expect(p.getByRole("heading", { name: "Terminvorlagen" })).toBeVisible();
  await expect(p.locator("main")).toContainText("Erstgespräch"); // Standardvorlagen vorhanden
  await p.getByLabel("Name der Vorlage").fill(`E2E-Kurztermin ${stamp}`);
  await p.getByLabel("Titel der Einladung").fill("Kurztermin {{ company.name }}");
  await p.getByLabel("Einladungstext").fill("Hallo {{ contact.FIRSTNAME }}, bis gleich!");
  await expect(p.locator("main")).toContainText("Kurztermin Berger Maschinenbau GmbH"); // Live-Vorschau
  await p.getByLabel("Dauer (Minuten)").fill("20");
  await p.locator('select[name="videoProvider"]').selectOption("jitsi");
  await p.getByRole("button", { name: "Speichern" }).click();
  const t = await waitFor(() => db().meetingType.findFirst({ where: { name: `E2E-Kurztermin ${stamp}` } }));
  expect(t.durationMin).toBe(20);
  expect(t.workspaceId).toBe(await wsId());
  beleg(`Vorlage ${t.id}`);
});

test("o · Termin mit Jitsi-Fallback → .ics-Einladung in Mailpit → Absage", async ({ as }) => {
  const ws = await wsId();
  const contact = await db().contact.findFirstOrThrow({ where: { workspaceId: ws, email: { contains: ".example." } }, orderBy: { createdAt: "asc" } });
  const p = await as("admin");
  await p.goto(`${SA}/kalender`);
  await p.getByRole("button", { name: "Termin mit Video-Call" }).first().click();
  const dlg = p.getByRole("dialog");
  await expect(dlg).toBeVisible();
  const title = `E2E-Videotermin ${stamp}`;
  await dlg.getByLabel("Titel (leer = aus Vorlage)").fill(title);
  // Beginn: übermorgen 10:00 Ortszeit
  const d = new Date(Date.now() + 2 * 864e5);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await dlg.getByLabel("Beginn").fill(`${ymd}T10:00`);
  await dlg.getByLabel("Dauer (Minuten)").fill("30");
  await dlg.getByRole("radio", { name: "Jitsi (ohne Konto)" }).check();
  await dlg.locator('select[name="contactIds"]').selectOption([contact.id]);
  await dlg.getByRole("button", { name: "Termin anlegen und einladen" }).click();
  await expect(dlg.getByRole("status")).toContainText("Termin angelegt", { timeout: 30_000 });
  await expect(dlg).toContainText("meet.jit.si");

  const ev = await waitFor(() => db().event.findFirst({ where: { workspaceId: ws, title } }));
  expect(ev.videoProvider).toBe("jitsi");
  expect(ev.joinUrl).toMatch(/^https:\/\/meet\.jit\.si\/pd-/);
  expect((ev.externalRefs as { ics?: boolean }).ics).toBe(true);
  const msgs = await waitFor(async () => {
    const m = await mailpitSearch(`subject:"Einladung: ${title}"`);
    return m.length >= 2 ? m : null;
  });
  const toContact = msgs.find((m) => m.To.some((t) => t.Address === contact.email));
  expect(toContact).toBeTruthy();
  const full = (await (await fetch(`${MAILPIT}/api/v1/message/${toContact!.ID}`)).json()) as { Attachments: { FileName: string }[] };
  expect(full.Attachments.some((a) => a.FileName === "einladung.ics")).toBe(true);
  const act = await waitFor(() => db().activity.findFirst({ where: { contactId: contact.id, body: { startsWith: `Termin geplant: ${title}` } } }));
  expect(act).toBeTruthy();
  const out = await waitFor(() => db().crmEvent.findFirst({ where: { workspaceId: ws, type: "meeting.scheduled", objectId: contact.id } }));
  expect(out).toBeTruthy();

  // Absagen über die Liste
  await dlg.getByRole("button", { name: "Schließen" }).first().click();
  await p.goto(`${SA}/kalender?m=${ymd.slice(0, 7)}`);
  await p.getByRole("button", { name: `Termin „${title}“ absagen` }).click();
  await waitFor(async () => (await db().event.findUnique({ where: { id: ev.id } }))?.status === "cancelled");
  const cancels = await waitFor(async () => {
    const m = await mailpitSearch(`subject:"Abgesagt: ${title}"`);
    return m.length >= 2 ? m : null;
  });
  expect(cancels.length).toBeGreaterThanOrEqual(2);
  beleg(`Termin ${ev.id}, Einladungen ${msgs.length}, Absagen ${cancels.length}`);
});

test("o · Nur-Lesen sieht keinen Termin-Knopf und keine Vorlagen-Bearbeitung", async ({ as }) => {
  const p = await as("nurlesen");
  await p.goto(`${SA}/kalender`);
  await expect(p.getByRole("button", { name: "Termin mit Video-Call" })).toHaveCount(0);
  await p.goto(`${SA}/kalender/vorlagen`);
  await expect(p.locator("main")).toContainText("Nur mit dem Recht");
  await expect(p.getByRole("button", { name: "Speichern" })).toHaveCount(0);
});

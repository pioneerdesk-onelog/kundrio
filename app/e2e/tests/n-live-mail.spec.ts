import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, SA, db, wsId, waitFor, beleg } from "../helpers";

// (n) Live-Mail-Abnahme: echte Zustellung an die Testkundin (E2E_CUSTOMER_EMAIL) über das echte SMTP.
// Läuft nur mit MAIL_MODE=live; die Freigabeliste (MAIL_LIVE_ALLOWLIST) verhindert Mails an andere echte Adressen.

const LIVE = process.env.MAIL_MODE === "live";
const CUSTOMER = (process.env.E2E_CUSTOMER_EMAIL ?? "").toLowerCase();
const SENDER = (process.env.E2E_SENDER_EMAIL ?? "").toLowerCase();
const RUN = `[CRM-Test ${new Date().toISOString().slice(0, 16).replace("T", " ")}]`;
const OUT = path.join(__dirname, "../out/live-mail.json");

type Entry = { ablauf: string; betreff: string; messageId: string | null; status: string; zustellweg: string | null; zeit: string };
const results: Entry[] = [];

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(!LIVE, "Nur mit MAIL_MODE=live");
test.skip(LIVE && (!CUSTOMER || !SENDER), "E2E_CUSTOMER_EMAIL und E2E_SENDER_EMAIL müssen gesetzt sein");

async function customer() {
  return db().contact.findFirstOrThrow({ where: { workspaceId: await wsId(), email: CUSTOMER } });
}

/** Wartet auf die zuletzt erzeugte Mail an die Kundin mit passendem Betreff und hält Status/Zustellweg fest. */
async function record(ablauf: string, subjectPart: string, since: Date) {
  const ws = await wsId();
  const msg = await waitFor(
    () =>
      db().emailMessage.findFirst({
        where: { workspaceId: ws, toAddr: { contains: CUSTOMER }, subject: { contains: subjectPart }, createdAt: { gte: since }, status: { notIn: ["queued"] } },
        orderBy: { createdAt: "desc" },
        include: { events: true },
      }),
    90_000,
  );
  const route = msg.events.find((e) => e.reason === "live" || e.reason === "captured")?.reason ?? null;
  results.push({ ablauf, betreff: msg.subject, messageId: msg.messageId, status: msg.status, zustellweg: route, zeit: msg.createdAt.toISOString() });
  beleg(`${ablauf}: „${msg.subject}“ → ${msg.status} (${route ?? "?"}) · ${msg.messageId}`);
  expect(msg.status, `${ablauf}: Status`).toBe("sent");
  expect(msg.fromAddr.toLowerCase(), `${ablauf}: Absender`).toBe(SENDER);
  return msg;
}

test.beforeAll(async () => {
  // Ausgangszustand: Kundin ohne Einwilligung, nicht abgemeldet, nicht gesperrt; Rate-Limits frei
  const c = await customer();
  await db().contact.update({ where: { id: c.id }, data: { consentEmailAt: null, consentSource: null, unsubscribedAt: null } });
  await db().suppression.deleteMany({ where: { workspaceId: c.workspaceId, email: CUSTOMER } });
  await db().$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
});

test.afterAll(async () => {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ lauf: RUN, absender: SENDER, kundin: CUSTOMER, ergebnisse: results }, null, 2));
});

test("n1 · Transaktionsmail über die Brevo-kompatible API", async ({ request }) => {
  const ws = await wsId();
  // API-Schlüssel wie lib/apikey.ts (nur Hash in der DB)
  const prefix = `pdk_${randomBytes(4).toString("hex")}`;
  const plain = `${prefix}_${randomBytes(24).toString("base64url")}`;
  await db().apiKey.create({ data: { workspaceId: ws, name: "E2E Live-Mail", scopes: ["mail:send"], prefix, hash: createHash("sha256").update(plain).digest("hex"), createdBy: "e2e" } });
  const since = new Date();
  const subject = `${RUN} Transaktionsmail`;
  const res = await request.post("/api/brevo/v3/smtp/email", {
    headers: { "api-key": plain, "content-type": "application/json" },
    data: {
      sender: { email: SENDER, name: "CRM Abnahmetest" },
      to: [{ email: CUSTOMER, name: "Testkundin" }],
      subject,
      htmlContent: `<p>Hallo,</p><p>dies ist eine <b>Transaktionsmail</b> aus dem Kundrio-Abnahmetest.</p><p>${RUN}</p>`,
      textContent: `Hallo,\n\ndies ist eine Transaktionsmail aus dem Kundrio-Abnahmetest.\n${RUN}`,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const msg = await record("1 Transaktionsmail (API)", subject, since);
  expect(msg.kind).toBe("transactional");
  expect(msg.htmlBody).toContain("Transaktionsmail");
});

test("n2 · Formular mit Double-Opt-in", async ({ page }) => {
  const ws = await wsId();
  const form = await db().form.findFirstOrThrow({ where: { workspaceId: ws, name: "Kontakt & Newsletter" } });
  const since = new Date();
  await page.goto(`/f/${form.id}`);
  await page.locator('input[name="firstName"]').fill("Marcus");
  await page.locator('input[name="lastName"]').fill("Testkunde");
  await page.locator('input[name="email"]').fill(CUSTOMER);
  await page.locator('input[name="consent"]').check();
  await page.waitForTimeout(3500); // realistische Ausfüllzeit (Echtheitsprüfung)
  await page.getByRole("button", { name: /Absenden|Senden/ }).click();
  await expect(page.locator("body")).toContainText(/bestätigen/i);

  const msg = await record("2 Double-Opt-in-Mail", "Bitte bestätigen", since);
  const link = (msg.bodyText.match(/https?:\/\/\S+\/c\/\S+/) ?? [])[0];
  expect(link, "DOI-Link im gesendeten Text").toBeTruthy();
  await page.goto(new URL(link!).pathname);
  await page.getByRole("button").first().click();
  const c = await waitFor(async () => {
    const x = await customer();
    return x.consentEmailAt ? x : null;
  });
  beleg(`Einwilligung bestätigt am ${c.consentEmailAt!.toISOString()} (${c.consentSource})`);
});

test("n3 · Prozess „Eingangsbestätigung“ veröffentlichen und auslösen", async ({ as, page }) => {
  const ws = await wsId();
  const proc = await db().process.findFirstOrThrow({ where: { workspaceId: ws, name: { contains: "Eingangsbestätigung" } } });
  const admin = await as("admin");
  admin.on("dialog", (d) => d.accept());
  await admin.goto(`${SA}/prozesse/${proc.id}`);
  await admin.getByRole("button", { name: /^Veröffentlichen$/ }).click();
  // Entweder direkt aktiv oder Freigabe nötig → im Freigabe-Eingang als Admin bestätigen
  await admin.waitForTimeout(2000);
  let p = await db().process.findUniqueOrThrow({ where: { id: proc.id } });
  if (p.status !== "ACTIVE") {
    const appr = await waitFor(() => db().approval.findFirst({ where: { workspaceId: ws, kind: "process.publish", status: "pending" }, orderBy: { createdAt: "desc" } }));
    await admin.goto(`/freigaben?id=${appr.id}`);
    await admin.getByRole("button", { name: /Zustimmen|Freigeben/ }).first().click();
    p = await waitFor(async () => {
      const x = await db().process.findUniqueOrThrow({ where: { id: proc.id } });
      return x.status === "ACTIVE" ? x : null;
    });
  }
  const version = await db().processVersion.findUniqueOrThrow({ where: { id: p.activeVersionId! } });
  expect(version.approvedAt, "Version mit Außenwirkung freigegeben").toBeTruthy();
  beleg(`Prozess aktiv (Version ${version.version}, freigegeben von ${version.approvedBy})`);

  // Erneute Formular-Einsendung der Kundin löst die Eingangsbestätigung aus
  const form = await db().form.findFirstOrThrow({ where: { workspaceId: ws, name: "Kontakt & Newsletter" } });
  const since = new Date();
  await page.goto(`/f/${form.id}`);
  await page.locator('input[name="firstName"]').fill("Marcus");
  await page.locator('input[name="lastName"]').fill("Testkunde");
  await page.locator('input[name="email"]').fill(CUSTOMER);
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /Absenden|Senden/ }).click();
  await expect(page.locator("body")).toContainText(/Danke/i);

  const c = await customer();
  const run = await waitFor(async () => {
    const r = await db().processRun.findFirst({ where: { processId: proc.id, objectId: c.id, startedAt: { gte: since } }, include: { steps: true } });
    return r && ["done", "failed", "goal_met"].includes(r.status) ? r : null;
  }, 90_000);
  expect(run.status, `Lauf ${run.id}: ${run.error ?? ""}`).toBe("done");
  expect(run.steps.some((s) => s.nodeType === "action.send_email" && s.status === "ok")).toBe(true);
  await record("3 Prozess-Mail (Eingangsbestätigung)", "Danke für Ihre Anfrage", since);
  beleg(`Prozesslauf ${run.id}: ${run.steps.map((s) => `${s.nodeType}=${s.status}`).join(", ")}`);
});

async function createCampaign(admin: import("@playwright/test").Page, name: string, subject: string) {
  const ws = await wsId();
  const list = await db().contactList.findFirstOrThrow({ where: { workspaceId: ws, name: "Bestandskunden" } });
  await admin.goto(`${SA}/email/kampagne/neu`);
  await admin.locator('input[name="name"]').fill(name);
  await admin.locator('input[name="subject"]').fill(subject);
  await admin.locator('textarea[name="bodyMarkdown"]').fill(`Hallo {{ contact.FIRSTNAME | default: "zusammen" }},\n\ndies ist eine Test-Kampagne aus dem Kundrio-Abnahmetest.\n\n${RUN}`);
  await admin.locator(`input[name="listIds"][value="${list.id}"]`).check();
  await admin.getByRole("button", { name: "Speichern" }).click();
  const c = await waitFor(() => db().campaign.findFirst({ where: { workspaceId: ws, name } }));
  await admin.goto(`${SA}/email/kampagne/${c.id}`);
  await admin.getByRole("checkbox", { name: /Ich gebe den Versand an \d+ Empfänger frei/ }).check();
  await admin.getByRole("button", { name: /Freigeben|freigeben/ }).first().click();
  await waitFor(async () => (await db().campaign.findUnique({ where: { id: c.id } }))?.approvedAt);
  await admin.getByRole("button", { name: /Versand|Senden|versenden/i }).first().click();
  return waitFor(async () => {
    const x = await db().campaign.findUnique({ where: { id: c.id }, include: { recipients: { include: { contact: true } } } });
    return x && ["SENT", "FAILED"].includes(x.status) ? x : null;
  }, 120_000);
}

test("n4 · Kampagne mit Abmeldelink, One-Click-Abmeldung, zweiter Versand überspringt", async ({ as, request }) => {
  const admin = await as("admin");
  const since = new Date();
  const subject = `${RUN} Kampagne 1`;
  const c1 = await createCampaign(admin, `Live-Test Kampagne 1 ${RUN}`, subject);
  expect(c1.status).toBe("SENT");
  const rec = c1.recipients.find((r) => r.contact.email?.toLowerCase() === CUSTOMER);
  expect(rec?.status, "Kundin erhält Kampagne").toBe("sent");
  const msg = await record("4a Kampagne (mit Abmeldelink)", subject, since);
  expect(msg.kind).toBe("campaign");
  const unsub = (msg.bodyText.match(/Abmelden: (https?:\/\/\S+)/) ?? [])[1];
  expect(unsub, "Abmeldelink im Text").toBeTruthy();
  // Regression: Anrede genau einmal, Platzhalter ersetzt (kein „Hallo Marcus, Hallo,“)
  expect(msg.bodyText.match(/Hallo/g)?.length, "Anrede genau einmal").toBe(1);
  expect(msg.bodyText).not.toContain("{{");

  // RFC 8058 One-Click (wie ein Mailprogramm über den List-Unsubscribe-Header)
  const r = await request.post(`${new URL(unsub!).pathname}/one-click`, { form: { "List-Unsubscribe": "One-Click" } });
  expect(r.status()).toBeLessThan(300);
  const cust = await waitFor(async () => {
    const x = await customer();
    return x.unsubscribedAt ? x : null;
  });
  beleg(`One-Click-Abmeldung: unsubscribedAt ${cust.unsubscribedAt!.toISOString()}`);

  const c2 = await createCampaign(admin, `Live-Test Kampagne 2 ${RUN}`, `${RUN} Kampagne 2`);
  const rec2 = c2.recipients.find((x) => x.contact.email?.toLowerCase() === CUSTOMER);
  expect(rec2 === undefined || rec2.status === "skipped", "abgemeldete Kundin übersprungen").toBe(true);
  const sentToCustomer = await db().emailMessage.count({ where: { campaignId: c2.id, toAddr: { contains: CUSTOMER } } });
  expect(sentToCustomer, "keine Mail der 2. Kampagne an die Kundin").toBe(0);
  results.push({ ablauf: "4b Kampagne 2 nach Abmeldung", betreff: `${RUN} Kampagne 2`, messageId: null, status: rec2?.status ?? "nicht in Zielgruppe", zustellweg: null, zeit: new Date().toISOString() });
  beleg(`Kampagne 2 (${c2.status}): Kundin ${rec2?.status ?? "nicht in Zielgruppe"}`);
});

test("n5 · Einzelmail an die Kundin über die Oberfläche", async ({ as }) => {
  const admin = await as("admin");
  const c = await customer();
  const since = new Date();
  const subject = `${RUN} Einzelmail`;
  await admin.goto(`${SA}/email`);
  const form = admin.locator("form").filter({ has: admin.locator('select[name="contactId"]') });
  await form.locator('select[name="contactId"]').selectOption(c.id);
  await form.locator('input[name="subject"]').fill(subject);
  await form.locator('textarea[name="text"]').fill(`Hallo,\n\ndies ist eine Einzelmail aus dem Kundrio-Abnahmetest.\n${RUN}`);
  await form.getByRole("button", { name: "Senden" }).click();
  await expect(admin).toHaveURL(/ok=/);
  const msg = await record("5 Einzelmail (Oberfläche)", subject, since);
  expect(msg.kind).toBe("one_to_one");
});

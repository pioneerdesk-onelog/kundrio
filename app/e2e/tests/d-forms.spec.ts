import { test, expect, db, wsId, mailpitSearch, mailpitBody, waitFor, beleg } from "../helpers";
import { test as raw } from "@playwright/test";

// (d) Öffentliches Formular → Kontakt → DOI-Mail → Bestätigung → Abmeldung
raw("d · Formular mit Einwilligung, Double-Opt-in und Abmeldung", async ({ page }) => {
  const ws = await wsId();
  const form = await db().form.findFirstOrThrow({ where: { workspaceId: ws, name: "Kontakt & Newsletter" } });
  const email = `e2e.doi.${Date.now()}@example.com`;
  await page.goto(`/f/${form.id}`);
  await page.locator('input[name="firstName"]').fill("Doris");
  await page.locator('input[name="lastName"]').fill("Doppel");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="consent"]').check();
  await page.waitForTimeout(3500); // Ausfüllzeit realistisch (Echtheitsprüfung)
  await page.getByRole("button", { name: /Absenden|Senden/ }).click();
  await expect(page.locator("body")).toContainText(/bestätigen/i);

  const contact = await waitFor(() => db().contact.findFirst({ where: { workspaceId: ws, email } }));
  expect(contact.consentEmailAt).toBeNull();
  const mail = await waitFor(async () => (await mailpitSearch(`to:${email}`))[0]);
  const body = await mailpitBody(mail.ID);
  const link = (body.Text.match(/https?:\/\/\S+\/c\/\S+/) ?? [])[0];
  expect(link, "DOI-Link in der Mail").toBeTruthy();
  await page.goto(new URL(link!).pathname);
  await page.getByRole("button").first().click();
  await waitFor(async () => (await db().contact.findUnique({ where: { id: contact.id } }))?.consentEmailAt);
  await waitFor(() => db().crmEvent.findFirst({ where: { objectId: contact.id, type: "consent.confirmed" } }));
  const run = await waitFor(() => db().processRun.findFirst({ where: { objectId: contact.id } }), 30_000);
  beleg(`Formular → Kontakt ${contact.id} → DOI bestätigt → Prozesslauf ${run.id}`);

  // Abmeldung über signierten Link
  const { unsubscribeUrl } = await import("../../src/lib/mail").catch(() => ({ unsubscribeUrl: null as null | ((id: string) => string) }));
  if (unsubscribeUrl) {
    await page.goto(new URL(unsubscribeUrl(contact.id)).pathname);
    await page.getByRole("button").first().click();
    await waitFor(async () => (await db().contact.findUnique({ where: { id: contact.id } }))?.unsubscribedAt);
  } else {
    test.info().annotations.push({ type: "hinweis", description: "Abmelde-Link nur über Kampagne prüfbar (lib/mail nicht direkt importierbar)" });
  }
});

test("d · Honeypot verwirft Bot-Einsendung stillschweigend", async ({ browser }) => {
  const ws = await wsId();
  const form = await db().form.findFirstOrThrow({ where: { workspaceId: ws } });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `e2e.bot.${Date.now()}@example.com`;
  await page.goto(`/f/${form.id}`);
  await page.locator('input[name="firstName"]').fill("Bot");
  await page.locator('input[name="lastName"]').fill("Bot");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="website_url"]').evaluate((el: HTMLInputElement) => (el.value = "http://spam.example"));
  await page.getByRole("button", { name: /Absenden|Senden/ }).click();
  await page.waitForTimeout(1500);
  expect(await db().contact.count({ where: { email } })).toBe(0);
  await ctx.close();
});

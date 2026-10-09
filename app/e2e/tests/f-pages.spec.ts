import { test, expect, SA, db, wsId, waitFor, beleg } from "../helpers";
import { test as raw } from "@playwright/test";

// (f) Landingpage: Editor, speichern, veröffentlichen (A11y), öffentliche Seite + Beacon + Bot-Erkennung
test("f · Editor öffnet, Entwurf speichern", async ({ as }) => {
  const ws = await wsId();
  const page = await db().landingPage.findFirstOrThrow({ where: { workspaceId: ws, slug: "ki-sprechstunde" } });
  const p = await as("marketing");
  await p.goto(`${SA}/seiten/${page.id}/editor`);
  await expect(p.locator("body")).toContainText(/Entwurf speichern|Speichern/);
  const before = page.updatedAt;
  await p.getByRole("button", { name: /Entwurf speichern|Speichern/ }).first().click();
  await waitFor(async () => {
    const x = await db().landingPage.findUnique({ where: { id: page.id } });
    return x && x.updatedAt > before ? x : null;
  }, 15_000);
  beleg(`Seite ${page.id} gespeichert`);
});

raw("f · Öffentliche Seite: JSON-LD, Formular, Beacon zählt Mensch, Bot wird serverseitig erkannt", async ({ page, request }) => {
  const ws = await wsId();
  const before = await db().analyticsEvent.count({ where: { workspaceId: ws } });
  const res = await page.goto("/p/e2e/de/ki-sprechstunde");
  expect(res?.status()).toBe(200);
  const html = await page.content();
  expect(html).toContain("FAQPage");
  await expect(page.locator('input[name="email"]')).toBeVisible();
  const bot = await request.get("/p/e2e/de/ki-sprechstunde", { headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" } });
  expect(bot.status()).toBe(200);
  await waitFor(async () => (await db().analyticsEvent.count({ where: { workspaceId: ws } })) >= before + 2, 15_000);
  const gpt = await db().analyticsEvent.findFirst({ where: { workspaceId: ws, botName: "GPTBot", ts: { gte: new Date(Date.now() - 60_000) } } });
  expect(gpt?.botCategory).toBe("ai_training");
  for (const f of ["llms.txt", "robots.txt", "sitemap.xml"]) expect((await request.get(`/p/e2e/${f}`)).status(), f).toBe(200);
});

test("f · Veröffentlichen mit A11y-Prüfung", async ({ as }) => {
  const ws = await wsId();
  const page = await db().landingPage.findFirstOrThrow({ where: { workspaceId: ws, slug: "ki-sprechstunde" } });
  const p = await as("admin");
  await p.goto(`${SA}/seiten/${page.id}`);
  await p.getByRole("button", { name: /veröffentlichen/i }).first().click();
  const x = await waitFor(async () => {
    const r = await db().landingPage.findUnique({ where: { id: page.id } });
    return r && r.publishedAt && r.publishedAt > page.publishedAt! ? r : null;
  }, 15_000);
  expect((x.a11yReport as { errors?: number })?.errors ?? 0).toBe(0);
});

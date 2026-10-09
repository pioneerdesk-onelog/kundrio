import { test, expect, SA, beleg } from "../helpers";

// (k) Übersichten laden mit Daten
test("k · Agentur-Übersicht zeigt Testmandant mit Kennzahlen", async ({ as }) => {
  const p = await as("agentur-admin");
  await p.goto("/");
  await expect(p.locator("main")).toContainText("E2E Testmandant");
  await expect(p.locator("main")).toContainText("Besuche von KI-Bots");
});

test("k · Analytics Sub-Account: KI-Bots und KI-Referrals vorhanden", async ({ as }) => {
  const p = await as("marketing");
  await p.goto(`${SA}/analytics`);
  await expect(p.locator("main")).toContainText("GPTBot");
  await expect(p.locator("main")).toContainText(/ChatGPT|chatgpt/);
  beleg("Analytics zeigt GPTBot und ChatGPT-Referrals");
});

test("k · Agentur-Analytics, Kosten, Souveränität laden", async ({ as }) => {
  const p = await as("agentur-admin");
  for (const [url, text] of [["/analytics", "E2E Testmandant"], ["/kosten", /Kosten|Nutzung/], ["/souveraenitaet", /Souveränität|Außenverbindungen/]] as const) {
    const r = await p.goto(url);
    expect(r?.status(), url).toBe(200);
    await expect(p.locator("main"), url).toContainText(text);
  }
});

test("k · Pflichten und Kanäle laden", async ({ as }) => {
  const p = await as("admin");
  await p.goto(`${SA}/pflichten`);
  await expect(p.locator("main")).toContainText(/Pflichten|Katalog/);
  await p.goto(`${SA}/kanaele`);
  await expect(p.locator("main")).toContainText("@e2e-testmandant");
});

test("k · Sub-Account-Dashboard zeigt Aufgaben und Aktivitäten", async ({ as }) => {
  const p = await as("teamleitung");
  await p.goto(SA);
  await expect(p.locator("main")).toContainText(/Offene Aufgaben|Aufgaben/);
});

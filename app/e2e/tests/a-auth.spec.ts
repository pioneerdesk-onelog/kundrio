import { test, expect, creds, beleg, db } from "../helpers";
import { test as raw } from "@playwright/test";

// (a) Anmeldung, Abmeldung, Konto
raw.describe("a · Anmeldung", () => {
  raw("ohne Anmeldung leitet jede interne Seite auf /login", async ({ page }) => {
    for (const url of ["/", "/sa/e2e", "/sa/e2e/kontakte", "/freigaben", "/benutzer"]) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/login/);
    }
  });

  raw("falsches Passwort zeigt neutrale Meldung, keine Sitzung", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(creds().users.admin.email);
    await page.locator('input[name="password"]').fill("falsch-falsch-falsch");
    await page.getByRole("button", { name: "Anmelden" }).click();
    // Next.js hat einen eigenen role="alert" (Routen-Ansager) → gezielt die Formularmeldung prüfen
    await expect(page.locator('form [role="alert"]')).toContainText("E-Mail oder Passwort ist falsch");
    await expect(page).toHaveURL(/\/login/);
  });

  raw("deaktiviertes Konto kann sich nicht anmelden", async ({ page }) => {
    const email = creds().users.nurlesen.email;
    await db().user.update({ where: { email }, data: { active: false } });
    try {
      await page.goto("/login");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(creds().password);
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page.locator('form [role="alert"]')).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await db().user.update({ where: { email }, data: { active: true } });
    }
  });
});

test.describe("a · Konto", () => {
  test("Konto zeigt Rolle je Sub-Account und Teams", async ({ as }) => {
    const p = await as("vertrieb-a");
    await p.goto("/konto");
    await expect(p.locator("body")).toContainText("Vera Vertrieb");
    await expect(p.locator("body")).toContainText(/Vertrieb/);
    await expect(p.locator("body")).toContainText("Vertrieb Süd");
    beleg("Konto vertrieb-a zeigt Rolle Vertrieb und Team Vertrieb Süd");
  });

  test("Abmelden beendet die Sitzung", async ({ as }) => {
    // eigene Sitzung, damit die gemeinsame Service-Sitzung für spätere Tests gültig bleibt
    const page = await as("service", { fresh: true });
    await page.goto("/sa/e2e");
    await page.getByRole("button", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/sa/e2e");
    await expect(page).toHaveURL(/\/login/);
  });
});

import { test, expect, SA, db, wsId, waitFor, mailpitSearch, mailpitBody, beleg } from "../helpers";

// (l) Benutzer einladen → Mail → Einladung annehmen → Rolle wirksam
test("l · Einladung als Service-Mitarbeiterin annehmen", async ({ as, browser }) => {
  const email = `e2e.eingeladen.${Date.now()}@pioneerdesk.test`;
  const p = await as("admin");
  await p.goto(`${SA}/team`);
  await p.locator('input[type="email"], input[name="email"]').first().fill(email);
  const roleSelect = p.locator('select[name="roleKey"], select[name="role"]').first();
  if (await roleSelect.count()) await roleSelect.selectOption({ value: "service" }).catch(() => roleSelect.selectOption({ label: "Service" }));
  await p.getByRole("button", { name: /Einladen|Einladung senden/ }).first().click();
  const mail = await waitFor(async () => (await mailpitSearch(`to:${email}`))[0], 30_000);
  const body = await mailpitBody(mail.ID);
  const link = (body.Text.match(/https?:\/\/\S+\/einladung\/\S+/) ?? [])[0];
  expect(link).toBeTruthy();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(new URL(link!).pathname);
  await page.locator('input[name="name"]').fill("Eva Eingeladen");
  await page.getByLabel("Passwort (mind. 12 Zeichen)").fill("E2E-Passwort-sehr-lang-1");
  await page.getByLabel("Passwort wiederholen").fill("E2E-Passwort-sehr-lang-1");
  await page.getByRole("button", { name: /Konto aktivieren|annehmen/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/einladung"), { timeout: 20_000 });
  const ws = await wsId();
  const u = await db().user.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { roleRef: true } } } });
  expect(u.active).toBe(true);
  expect(u.memberships.find((m) => m.workspaceId === ws)?.roleRef?.key).toBe("service");
  beleg(`Einladung angenommen: ${u.id}`);
  await ctx.close();
});

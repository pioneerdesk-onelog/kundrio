import { test, expect, SA, db, wsId, beleg, storageFor, AREAS } from "../helpers";
import { axeScan, cleanupPublicPages, describe, isBlocking, publicPages } from "../a11y";

// (u) Barrierefreiheit & Darstellung (Testplan Feature-Freeze, Block 6 + Erkundungstest Block 2):
// axe (WCAG 2.1 A/AA) ohne kritische/schwere Verstöße auf allen Hauptseiten (hell + dunkel) und den öffentlichen Seiten,
// Tastaturbedienung (Sprunglink, sichtbarer Fokus, Dialog mit Escape, Kanban per Tastatur), mobile Darstellung (390 px)
// und Texte/Formate, die im Erkundungstest auffielen.

const stamp = Date.now().toString(36);

/** Hauptseiten im Admin: Agentur-Bereiche + alle Reiter des Sub-Accounts (wie die Navigation) */
const AGENCY = ["/", "/freigaben", "/analytics", "/souveraenitaet", "/kosten", "/benutzer", "/konto", "/konto/kalender", "/konto/apps"];
const SUB = [SA, ...AREAS.map(([k]) => `${SA}/${k}`), `${SA}/zahlungen/abgleich`, `${SA}/rechnungen/neu`, `${SA}/email/kampagne/neu`];
const DARK = ["/", "/konto", SA, `${SA}/kontakte`, `${SA}/pipeline`, `${SA}/tickets`, `${SA}/posteingang`, `${SA}/rechnungen`, `${SA}/kalender`, `${SA}/einstellungen`];

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await cleanupPublicPages();
  await db().deal.deleteMany({ where: { workspaceId: await wsId(), title: `A11y-Tastatur ${stamp}` } });
});

for (const scheme of ["light", "dark"] as const) {
  test(`u · axe: Hauptseiten im Admin ohne kritische/schwere Verstöße (${scheme === "light" ? "hell" : "dunkel"})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ storageState: storageFor("agentur-admin"), colorScheme: scheme });
    const p = await ctx.newPage();
    const failures: string[] = [];
    const urls = scheme === "light" ? [...AGENCY, ...SUB] : DARK;
    for (const url of urls) {
      const res = await p.goto(url);
      expect(res?.status(), url).toBe(200);
      await p.waitForLoadState("networkidle").catch(() => {});
      const blocking = (await axeScan(p)).filter(isBlocking);
      if (blocking.length) failures.push(`${url}\n${describe(blocking)}`);
    }
    await ctx.close();
    expect(failures, failures.join("\n\n")).toEqual([]);
    beleg(`axe ${scheme}: ${urls.length} Seiten, 0 kritische/schwere Verstöße`);
  });
}

test("u · axe: öffentliche Seiten (Formular, Buchung, Landingpage, Kundenportal, Annahme, Zahlung, Login, 404)", async ({ browser }) => {
  test.setTimeout(120_000);
  const urls = await publicPages();
  const failures: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    // Einblend-Animationen der Landingpage würden halbtransparenten Text messen → reduzierte Bewegung, dann warten
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, colorScheme: scheme, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    for (const [name, url] of Object.entries(urls)) {
      const res = await p.goto(url);
      expect(res?.status(), `${name} ${url}`).toBe(name === "404" ? 404 : 200);
      await p.waitForLoadState("networkidle").catch(() => {});
      const blocking = (await axeScan(p)).filter(isBlocking);
      if (blocking.length) failures.push(`${name} (${scheme})\n${describe(blocking)}`);
    }
    await ctx.close();
  }
  expect(failures, failures.join("\n\n")).toEqual([]);
  beleg(`axe öffentlich: ${Object.keys(urls).join(", ")} – hell + dunkel, 0 kritische/schwere Verstöße`);
});

test("u · Tastatur: Sprunglink zuerst, Fokus sichtbar, Dialog schließt mit Escape", async ({ as }) => {
  const p = await as("admin");
  await p.goto(`${SA}/kalender`);
  await p.keyboard.press("Tab");
  const skip = p.getByRole("link", { name: "Zum Inhalt springen" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await p.keyboard.press("Enter");
  await expect(p).toHaveURL(/#inhalt$/);

  // Sichtbarer Fokusrahmen auf einem Bedienelement
  const btn = p.getByRole("button", { name: /Termin mit Video-Call/ }).first();
  await btn.focus();
  const outline = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");

  // Dialog per Tastatur öffnen und mit Escape schließen; Fokus kehrt zurück
  await p.keyboard.press("Enter");
  const dialog = p.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await p.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(btn).toBeFocused();
});

test("u · Tastatur: Kanban-Karte mit Leertaste und Pfeiltaste eine Phase weiter", async ({ as }) => {
  const ws = await wsId();
  const pipeline = await db().pipeline.findFirstOrThrow({ where: { workspaceId: ws, objectType: "deal" }, orderBy: { createdAt: "asc" }, include: { stages: { orderBy: { position: "asc" } } } });
  const [first, second] = pipeline.stages.filter((s) => s.kind === "OPEN");
  const deal = await db().deal.create({ data: { workspaceId: ws, pipelineId: pipeline.id, stageId: first.id, title: `A11y-Tastatur ${stamp}`, valueCents: 100000 } });
  const p = await as("admin");
  await p.goto(`${SA}/pipeline`);
  const handle = p.getByRole("button", { name: `„${deal.title}“ verschieben` });
  await handle.focus();
  await expect(handle).toBeFocused();
  await expect(handle).toHaveAttribute("aria-roledescription", "verschiebbare Karte");
  // wie ein Mensch: kurze Pausen, damit dnd-kit zwischen den Tasten die Lage misst
  await p.keyboard.press("Space");
  await expect(p.locator('[id^="DndLiveRegion"]')).toContainText(`Über Phase „${first.name}“`);
  await p.waitForTimeout(150); // dnd-kit hängt die Pfeiltasten-Behandlung erst im nächsten Tick an (setTimeout)
  await p.keyboard.press("ArrowRight");
  await expect(p.locator('[id^="DndLiveRegion"]')).toContainText(`Über Phase „${second.name}“`);
  await p.keyboard.press("Space");
  await expect.poll(async () => (await db().deal.findUniqueOrThrow({ where: { id: deal.id } })).stageId).toBe(second.id);
  beleg(`Kanban per Tastatur: „${first.name}“ → „${second.name}“`);
});

test("u · Mobil (390 px): kein seitliches Scrollen, Menü per Knopf", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storageFor("vertrieb-a"), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  for (const url of ["/", SA, `${SA}/kontakte`, `${SA}/pipeline`, `${SA}/rechnungen`]) {
    await p.goto(url);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${url}: ${over} px zu breit`).toBeLessThanOrEqual(1);
  }
  // Agentur-Übersicht mit allen Projektkarten (Agentur-Admin sieht fünf Sub-Accounts)
  const actx = await browser.newContext({ storageState: storageFor("agentur-admin"), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ap = await actx.newPage();
  await ap.goto("/");
  expect(await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await actx.close();
  const menu = p.getByRole("button", { name: "Menü" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(p.getByRole("navigation", { name: "Agentur" })).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(p.getByRole("navigation", { name: "Agentur" })).toBeVisible();
  await ctx.close();
});

test("u · Darstellung: Einstellungen ohne Überlauf, Datum deutsch, keine Technik-Texte für Fachrollen, kein Hydrationsfehler", async ({ as }) => {
  const a = await as("admin");
  await a.goto(`${SA}/einstellungen`);
  expect(await a.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await a.goto(`${SA}/analytics`);
  const caption = (await a.locator("figcaption").allInnerTexts()).join(" ");
  expect(caption).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(caption).toMatch(/\d{2}\.\d{2}\.\d{4}/);

  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(`${SA}/zahlungen/abgleich`);
  await a.waitForLoadState("networkidle").catch(() => {});
  expect(errors, errors.join("\n")).toEqual([]);

  await a.goto(`${SA}/api`);
  await expect(a.locator("main")).not.toContainText(/mcp:read\s+–\s+mcp:read/);

  const v = await as("vertrieb-a");
  await v.goto("/konto/kalender");
  await expect(v.locator("main")).not.toContainText("GOOGLE_CLIENT_ID");
  await expect(v.locator("main")).toContainText("Agentur-Administration");
});

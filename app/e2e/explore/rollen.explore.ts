import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SA, storageFor, type RoleKey } from "../helpers";
import { axeScan, isBlocking, publicPages, type Violation } from "../a11y";

// Erkundungstest je Rolle (Testplan Feature-Freeze, Block 2): typischer Arbeitstag als Klickpfad,
// Screenshot jeder Seite (Desktop 1440 px, Hauptseiten zusätzlich mobil 390 px, ausgewählte Seiten dunkel)
// und automatische Textprüfungen. Ergebnis je Rolle in e2e/out/explore/<rolle>/befunde.json.

const OUT = path.join(__dirname, "../out/explore");
const ONLY_AXE = process.env.EXPLORE_AXE !== "0";

type Finding = {
  step: string; url: string; status: number; title: string; file: string;
  nav?: string[]; english: string[]; placeholders: string[]; rawNumbers: string[]; isoDates: string[];
  duForm: string[]; overflowX: boolean; consoleErrors: string[]; denied: boolean;
  axe?: { blocking: number; ids: string[]; violations: Violation[] };
};

/** Typischer Arbeitstag je Rolle: Startseiten + Detailseiten, die die Rolle braucht. */
const DAY: Record<string, { label: string; role: RoleKey; extra: string[]; details: string[]; denied: string[] }> = {
  "agentur-admin": { label: "Agentur-Admin", role: "agentur-admin", extra: ["/freigaben", "/analytics", "/souveraenitaet", "/kosten", "/benutzer", "/konto", "/konto/kalender", "/konto/apps"], details: ["kontakte", "unternehmen", "pipeline", "tickets", "rechnungen", "prozesse", "seiten", "formulare", "listen"], denied: [] },
  "agentur-mitarbeiter": { label: "Agentur-Mitarbeiter", role: "agentur-mitarbeiter", extra: ["/freigaben", "/analytics", "/konto"], details: ["kontakte", "pipeline", "tickets"], denied: ["/benutzer", "/kosten"] },
  admin: { label: "Admin", role: "admin", extra: ["/freigaben", "/konto", `${SA}/team/rollen`, `${SA}/rechnungen/neu`, `${SA}/email/kampagne/neu`], details: ["kontakte", "unternehmen", "pipeline", "tickets", "rechnungen", "prozesse"], denied: ["/benutzer"] },
  teamleitung: { label: "Teamleitung", role: "teamleitung", extra: ["/konto"], details: ["kontakte", "unternehmen", "pipeline", "tickets"], denied: [`${SA}/einstellungen`, `${SA}/team`] },
  vertrieb: { label: "Vertrieb", role: "vertrieb-a", extra: ["/konto", "/konto/kalender"], details: ["kontakte", "unternehmen", "pipeline"], denied: [`${SA}/rechnungen`, `${SA}/einstellungen`] },
  service: { label: "Service", role: "service", extra: ["/konto"], details: ["tickets", "kontakte"], denied: [`${SA}/pipeline`, `${SA}/einstellungen`] },
  marketing: { label: "Marketing", role: "marketing", extra: ["/konto", `${SA}/email/kampagne/neu`, `${SA}/email/vorlagen`], details: ["seiten", "formulare", "listen", "kontakte"], denied: [`${SA}/rechnungen`, `${SA}/einstellungen`] },
  buchhaltung: { label: "Buchhaltung", role: "buchhaltung", extra: ["/konto", `${SA}/rechnungen/neu`, `${SA}/rechnungen/texte`, `${SA}/abos/mandate`, `${SA}/abos/lastschrift`, `${SA}/zahlungen/abgleich`, `${SA}/zahlungen/anbieter`], details: ["rechnungen"], denied: [`${SA}/pipeline`, `${SA}/einstellungen`] },
  nurlesen: { label: "Nur lesen", role: "nurlesen", extra: ["/konto"], details: ["kontakte", "pipeline", "tickets", "rechnungen"], denied: [`${SA}/einstellungen`, `${SA}/team`] },
};

const MOBILE = ["/", SA, `${SA}/kontakte`, `${SA}/pipeline`, `${SA}/posteingang`, `${SA}/rechnungen`];
const DARK = ["/", SA, `${SA}/kontakte`, `${SA}/pipeline`, `${SA}/posteingang`, `${SA}/rechnungen`, `${SA}/tickets`, `${SA}/einstellungen`, "/konto"];

const ENGLISH = /\b(Loading|Submit|Cancel|Save|Delete|Edit|Search|Settings|Error|Success|Untitled|Click here|Learn more|Sign in|Log in|Logout|Next|Previous|Back|Close|Open|Yes|No|None|Unknown|Pending|Draft|Failed|Created|Updated|Today|Yesterday|Week|Month|Year|Total|Amount|Status: [a-z]+|Something went wrong|Not found|Page|of)\b/g;
const PLACEHOLDER = /\{\{[^}]*\}\}|\[object Object\]|\bundefined\b|\bNaN\b|Invalid Date|\bnull\b|TODO|FIXME|Lorem ipsum|xxx/gi;
const RAW_NUMBER = /(?<![\d.,\-/:#\w€])(?!(19|20)\d\d\b)\d{4,}(?![\d.,:/\-%\w])/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?\b/g;
const DU = /(?<![A-Za-zÄÖÜäöü])(du|dein|deine|deinen|deinem|deiner|dich|dir)(?![A-Za-zÄÖÜäöü])/g;
const DENIED = /Keine Berechtigung|Kein Zugriff|Dafür fehlt die Berechtigung/;

const uniq = (a: string[]) => [...new Set(a)].slice(0, 15);
const slugify = (u: string) => (u.replace(/^\/+/, "").replace(/[/?=&.]+/g, "_") || "start").slice(0, 80);

async function inspect(page: Page, role: string, step: string, url: string, status: number, opts: { suffix?: string; axe?: boolean; errors: string[] }): Promise<Finding> {
  const dir = path.join(OUT, role);
  mkdirSync(dir, { recursive: true });
  const file = `${step}${opts.suffix ?? ""}.png`;
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: path.join(dir, file), fullPage: true });
  const text = (await page.locator("main").count()) ? await page.locator("main").first().innerText() : await page.locator("body").innerText();
  const navs = await page.locator('nav[aria-label="Bereiche des Sub-Accounts"] a, nav[aria-label="Agentur"] a').allInnerTexts().catch(() => []);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const f: Finding = {
    step, url, status, title: await page.title(), file, nav: navs.map((n) => n.trim()),
    english: uniq(text.match(ENGLISH) ?? []), placeholders: uniq(text.match(PLACEHOLDER) ?? []),
    rawNumbers: uniq(text.match(RAW_NUMBER) ?? []), isoDates: uniq(text.match(ISO_DATE) ?? []), duForm: uniq(text.match(DU) ?? []),
    overflowX, consoleErrors: uniq(opts.errors.splice(0)), denied: DENIED.test(text),
  };
  if (opts.axe && ONLY_AXE) {
    const vs = await axeScan(page).catch(() => [] as Violation[]);
    f.axe = { blocking: vs.filter(isBlocking).length, ids: vs.map((v) => `${v.id}:${v.impact}`), violations: vs };
  }
  return f;
}

async function newCtx(browser: Browser, role: RoleKey | null, viewport: { width: number; height: number }, dark = false): Promise<BrowserContext> {
  return browser.newContext({
    storageState: role ? storageFor(role) : { cookies: [], origins: [] },
    viewport, locale: "de-DE", timezoneId: "Europe/Berlin", colorScheme: dark ? "dark" : "light",
    ...(viewport.width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
}

function hook(page: Page, errors: string[]) {
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
}

for (const [key, day] of Object.entries(DAY)) {
  test(`Erkundung · ${day.label}`, async ({ browser }) => {
    const findings: Finding[] = [];
    const errors: string[] = [];
    const ctx = await newCtx(browser, day.role, { width: 1440, height: 900 });
    const page = await ctx.newPage();
    hook(page, errors);
    let n = 0;
    const visit = async (url: string, label?: string) => {
      const res = await page.goto(url).catch(() => null);
      n += 1;
      const step = `${String(n).padStart(2, "0")}-${label ?? slugify(url)}`;
      findings.push(await inspect(page, key, step, url, res?.status() ?? 0, { axe: true, errors }));
    };

    // 1. Morgens: Übersicht, Agentur-Bereiche
    await visit("/", "uebersicht");
    for (const u of day.extra.filter((u) => !u.startsWith(SA))) await visit(u);
    // 2. Sub-Account: alle Reiter, die die Navigation anbietet
    await visit(SA, "sa-dashboard");
    const tabs = (await page.locator('nav[aria-label="Bereiche des Sub-Accounts"] a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""))).filter((h) => h && h !== SA);
    for (const href of tabs) await visit(href);
    // 3. Detailseiten (erster Eintrag der Liste)
    for (const area of day.details) {
      if (!tabs.includes(`${SA}/${area}`)) continue;
      await page.goto(`${SA}/${area}`);
      const hrefs = await page.locator(`main a[href^="${SA}/${area}/"]`).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
      const detail = hrefs.find((h) => /\/[a-z0-9]{20,}(\/)?$/.test(h) || (area === "wiki" && h.split("/").length > 4));
      if (detail) await visit(detail, `detail-${area}`);
    }
    // 4. Zusatzseiten im Sub-Account (Formulare „neu“, Unterseiten)
    for (const u of day.extra.filter((u) => u.startsWith(SA))) await visit(u);
    // 5. Gesperrte Seiten: Sperrhinweis verständlich?
    for (const u of day.denied) await visit(u, `gesperrt-${slugify(u)}`);
    await ctx.close();

    // 6. Mobil (390 px)
    const mctx = await newCtx(browser, day.role, { width: 390, height: 844 });
    const mpage = await mctx.newPage();
    hook(mpage, errors);
    for (const u of MOBILE.filter((u) => u === "/" || u === SA || tabs.includes(u))) {
      const res = await mpage.goto(u).catch(() => null);
      findings.push(await inspect(mpage, key, `m-${slugify(u)}`, u, res?.status() ?? 0, { suffix: "-390", errors }));
    }
    await mctx.close();

    // 7. Dunkler Modus (nur Admin-Rollen, sonst gleiche Seiten)
    if (key === "agentur-admin" || key === "vertrieb") {
      const dctx = await newCtx(browser, day.role, { width: 1440, height: 900 }, true);
      const dpage = await dctx.newPage();
      hook(dpage, errors);
      for (const u of DARK.filter((u) => u === "/" || u === "/konto" || u === SA || tabs.includes(u))) {
        const res = await dpage.goto(u).catch(() => null);
        findings.push(await inspect(dpage, key, `d-${slugify(u)}`, u, res?.status() ?? 0, { suffix: "-dunkel", axe: true, errors }));
      }
      await dctx.close();
    }
    writeFileSync(path.join(OUT, key, "befunde.json"), JSON.stringify({ role: day.label, tabs, findings }, null, 2));
  });
}

test("Erkundung · Öffentliche Seiten (ohne Anmeldung)", async ({ browser }) => {
  const urls = await publicPages();
  const findings: Finding[] = [];
  const errors: string[] = [];
  for (const [mode, vp, dark] of [["", { width: 1440, height: 900 }, false], ["-390", { width: 390, height: 844 }, false], ["-dunkel", { width: 1440, height: 900 }, true]] as const) {
    const ctx = await newCtx(browser, null, vp, dark);
    const page = await ctx.newPage();
    hook(page, errors);
    for (const [name, u] of Object.entries(urls)) {
      const res = await page.goto(u).catch(() => null);
      findings.push(await inspect(page, "oeffentlich", name, u, res?.status() ?? 0, { suffix: mode, axe: mode !== "-390", errors }));
    }
    await ctx.close();
  }
  writeFileSync(path.join(OUT, "oeffentlich", "befunde.json"), JSON.stringify({ role: "Öffentlich", findings }, null, 2));
});

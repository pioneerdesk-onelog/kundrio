import { expect, test as base, type Page, type Response } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FULL, PRESETS, allows, type ObjectKey, type Special } from "../src/lib/permissions/catalog";
import { AREA_NEEDS, type Need } from "../src/lib/permissions/areas";

export const AUTH_DIR = path.join(__dirname, ".auth");
export const SLUG = "e2e";
export const SA = `/sa/${SLUG}`;
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:58025";

export type Creds = { password: string; users: Record<string, { email: string; name: string; role: string | null; agencyRole: string; team: string | null }> };
export function creds(): Creds {
  return JSON.parse(readFileSync(path.join(AUTH_DIR, "credentials.json"), "utf8"));
}

/** Rollen der Testbenutzer (Schlüssel wie in scripts/seed-e2e.ts) */
export const ROLE_KEYS = [
  "agentur-admin", "agentur-mitarbeiter", "admin", "teamleitung", "vertrieb-a", "vertrieb-b", "vertrieb-c",
  "service", "marketing", "buchhaltung", "nurlesen",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const storageFor = (role: RoleKey) => path.join(AUTH_DIR, `${role}.json`);

/** Effektive Rechte eines Testbenutzers – aus den Seed-Zugangsdaten (Agentur-Rolle bzw. Rolle im Sub-Account) */
export function permsOf(role: RoleKey) {
  const u = creds().users[role];
  if (u.agencyRole === "owner" || u.agencyRole === "admin") return FULL;
  const key = (u.role ?? "nurlesen") as keyof typeof PRESETS;
  return PRESETS[key].permissions;
}
/** Gleiche Auswertung wie die App (src/lib/permissions/guard.ts `meets`): Reichweite own/team zählt bei Objekten mit Zuständigen */
export function meetsNeed(role: RoleKey, need: Need): boolean {
  const perms = permsOf(role);
  if ("anyOf" in need) return need.anyOf.some((n) => meetsNeed(role, n));
  if ("special" in need) return perms.special[need.special];
  return allows(perms, need.object, need.action, { userId: "e2e" });
}
export const AREAS = Object.entries(AREA_NEEDS).filter(([k]) => k !== "automationen"); // automationen leitet nur auf prozesse um
export const canRead = (role: RoleKey, o: ObjectKey) => permsOf(role).objects[o].read !== "none";
export const canEdit = (role: RoleKey, o: ObjectKey) => permsOf(role).objects[o].edit !== "none";
export const hasSpecial = (role: RoleKey, s: Special) => permsOf(role).special[s];

// ---------- Datenbank (Prüfung im Hintergrund) ----------
let _db: PrismaClient | null = null;
export function db() {
  return (_db ??= new PrismaClient());
}
export async function wsId() {
  return (await db().workspace.findUniqueOrThrow({ where: { slug: SLUG } })).id;
}

// ---------- Mailpit ----------
export async function mailpitSearch(query: string) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await r.json()) as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] }).messages ?? [];
}
export async function mailpitBody(id: string) {
  const r = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  return (await r.json()) as { Text: string; HTML: string; Subject: string };
}
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000, step = 1000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Zeitüberschreitung nach ${ms} ms`);
    await new Promise((r) => setTimeout(r, step));
  }
}

// ---------- Erwartungen ----------
const DENIED = /Keine Berechtigung|Kein Zugriff|Dafür fehlt die Berechtigung|nicht gefunden|This page could not be found|404/i;

/** Seite muss für die Rolle gesperrt sein (403/404 oder Hinweis „keine Berechtigung“). */
export async function expectDenied(page: Page, url: string) {
  const res = (await page.goto(url)) as Response;
  const status = res?.status() ?? 0;
  if (status === 403 || status === 404) return;
  await expect(page.locator("body")).toContainText(DENIED);
}

/** Seite muss für die Rolle erreichbar sein (200, kein Sperrhinweis, keine Fehlerseite). */
export async function expectAllowed(page: Page, url: string) {
  const res = (await page.goto(url)) as Response;
  expect(res?.status(), `${url} HTTP-Status`).toBe(200);
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error|Keine Berechtigung|Kein Zugriff/i);
}

/** Beleg im Testprotokoll (erscheint als Annotation im JSON-Report) */
export function beleg(text: string) {
  test.info().annotations.push({ type: "beleg", description: text });
}

/**
 * Test-Fixture mit Rollen-Login über gespeicherte Sitzungen.
 * `fresh: true` legt eine eigene, neue Sitzung an – nötig für Tests, die die Sitzung beenden
 * (Abmelden), damit die gemeinsame Sitzung der Rolle für spätere Tests gültig bleibt.
 */
export const test = base.extend<{ as: (role: RoleKey, opts?: { fresh?: boolean }) => Promise<Page> }>({
  as: async ({ browser, baseURL }, provide) => {
    const opened: Page[] = [];
    await provide(async (role: RoleKey, opts?: { fresh?: boolean }) => {
      let storageState: string | { cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Lax" }[]; origins: [] } = storageFor(role);
      if (opts?.fresh) {
        const { createHash, randomBytes } = await import("node:crypto");
        const user = await db().user.findUniqueOrThrow({ where: { email: creds().users[role].email } });
        const token = randomBytes(32).toString("base64url");
        const expires = new Date(Date.now() + 3600e3);
        await db().session.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt: expires } });
        const host = new URL(baseURL ?? "http://127.0.0.1:3100").hostname;
        storageState = { cookies: [{ name: "pd_session", value: token, domain: host, path: "/", expires: Math.floor(expires.getTime() / 1000), httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
      }
      const ctx = await browser.newContext({ storageState });
      const p = await ctx.newPage();
      opened.push(p);
      return p;
    });
    for (const p of opened) await p.context().close();
  },
});
export { expect };

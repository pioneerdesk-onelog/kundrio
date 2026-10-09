// DB-Integrationstest Einwilligungsnachweis (Art. 7 Abs. 1 DSGVO). Läuft nur mit Datenbank (Sub-Account „e2e“):
//   node --env-file=.env node_modules/vitest/vitest.mjs run src/lib/b-consent.db.test.ts
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enabled = !!process.env.DATABASE_URL && process.env.MAIL_MODE !== "smtp";
const tag = `doi${Date.now().toString(36)}`;

describe.skipIf(!enabled)("Double-Opt-in-Nachweis (DB)", () => {
  const ids: { form?: string; contact?: string } = {};
  afterAll(async () => {
    const { db } = await import("./db");
    if (ids.contact) await db.contact.deleteMany({ where: { id: ids.contact } });
    if (ids.form) await db.form.deleteMany({ where: { id: ids.form } });
    await db.$disconnect();
  });

  it("speichert den Wortlaut der Einwilligung zum Zeitpunkt der Bestätigung (Text kann sich später ändern)", async () => {
    const { db } = await import("./db");
    const { confirmConsent } = await import("./b-consent");
    const ws = await db.workspace.findUniqueOrThrow({ where: { slug: "e2e" } });
    const text = `Ich möchte den Newsletter erhalten (${tag}).`;
    const form = await db.form.create({ data: { workspaceId: ws.id, name: `DOI-Test ${tag}`, fields: [], consentText: text } });
    ids.form = form.id;
    const c = await db.contact.create({ data: { workspaceId: ws.id, email: `${tag}@example.invalid` } });
    ids.contact = c.id;

    expect(await confirmConsent(c.id, form.id)).toBe(true);
    // Späteres Umformulieren darf den Nachweis nicht verändern
    await db.form.update({ where: { id: form.id }, data: { consentText: "geänderter Text" } });

    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.consentEmailAt).toBeInstanceOf(Date);
    expect(after.consentSource).toContain(form.id);
    const act = await db.activity.findFirstOrThrow({ where: { contactId: c.id, type: "SYSTEM" } });
    expect((act.meta as { consentText?: string }).consentText).toBe(text);
  }, 30_000);
});

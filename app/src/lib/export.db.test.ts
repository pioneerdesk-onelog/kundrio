// DB-Integrationstest Sub-Account-Export (Art. 20 DSGVO). Läuft nur mit Datenbank (Sub-Account „e2e“):
//   node --env-file=.env node_modules/vitest/vitest.mjs run src/lib/export.db.test.ts
import { afterAll, describe, expect, it, vi } from "vitest";
import { strFromU8 } from "fflate";
import { EXPORTED } from "./export-coverage";

vi.mock("server-only", () => ({}));

const enabled = !!process.env.DATABASE_URL && process.env.MAIL_MODE !== "smtp";

describe.skipIf(!enabled)("Sub-Account-Export (DB)", () => {
  afterAll(async () => {
    const { db } = await import("./db");
    await db.$disconnect();
  });

  it("enthält jede Datei aus der Abdeckungsliste und keine Zugangsdaten", async () => {
    const { db } = await import("./db");
    const { buildWorkspaceExport } = await import("./export");
    const ws = await db.workspace.findUniqueOrThrow({ where: { slug: "e2e" } });
    const files = await buildWorkspaceExport(ws.id);
    const missing = [...new Set(Object.values(EXPORTED))].filter((f) => !(f in files));
    expect(missing).toEqual([]);
    // Verschlüsselte Zugangsdaten, Schlüssel-Hashes und die verschlüsselte IBAN gehören nicht in den Export
    const text = Object.entries(files)
      .filter(([k]) => k.endsWith(".json"))
      .map(([, v]) => strFromU8(v as Uint8Array))
      .join("\n");
    for (const key of ['"credentials"', '"providerCredentials"', '"ibanEncrypted"', '"secret"', '"tokenHash"', '"hash"', '"passwordHash"']) {
      expect(text.includes(key), key).toBe(false);
    }
  }, 60_000);
});

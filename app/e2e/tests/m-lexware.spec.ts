import { test } from "../helpers";
import { existsSync } from "node:fs";
import path from "node:path";

// (m) Lexware Office – Gerüst. Wird aktiv, sobald die Integration existiert und LEXWARE_API_KEY gesetzt ist.
const integration = existsSync(path.join(__dirname, "../../src/lib/lexware")) || existsSync(path.join(__dirname, "../../src/lib/lexware.ts"));
const key = !!process.env.LEXWARE_API_KEY;

test.describe("m · Lexware Office", () => {
  test.skip(!integration, "Lexware-Integration noch nicht vorhanden");
  test.skip(!key, "LEXWARE_API_KEY nicht gesetzt");
  test("m · Kontakt nach Lexware übertragen", async () => {});
  test("m · Rechnung RE-2026-9001 als Beleg nach Lexware übertragen", async () => {});
  test("m · Zahlungsstatus aus Lexware zurücklesen", async () => {});
});

import { describe, expect, it } from "vitest";
import { validateProductionEnv } from "./env";

const ok = {
  DATABASE_URL: "postgresql://x",
  APP_SECRET: "a".repeat(40),
  APP_URL: "https://crm.example.de",
  MAIL_EVENTS_SECRET: "b".repeat(30),
  TRUST_PROXY: "1",
} as unknown as NodeJS.ProcessEnv;

describe("validateProductionEnv", () => {
  it("akzeptiert vollständige Konfiguration", () => {
    expect(validateProductionEnv(ok)).toEqual([]);
  });
  it("meldet http-URL, kurzes Geheimnis und fehlenden Proxy-Wert", () => {
    const p = validateProductionEnv({ ...ok, APP_URL: "http://x", APP_SECRET: "kurz", TRUST_PROXY: "" });
    expect(p.join("|")).toMatch(/https/);
    expect(p.join("|")).toMatch(/32 Zeichen/);
    expect(p.join("|")).toMatch(/TRUST_PROXY/);
  });
  it("verbietet private Webhooks in Produktion", () => {
    expect(validateProductionEnv({ ...ok, WEBHOOK_ALLOW_PRIVATE: "true" }).length).toBe(1);
  });
});

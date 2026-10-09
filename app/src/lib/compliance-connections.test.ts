import { describe, expect, it } from "vitest";
import { externalConnections, regionViolations } from "./compliance-connections";

const env = { OLLAMA_BASE_URL: "http://127.0.0.1:11434", MAIL_MODE: "capture" };

describe("regionViolations", () => {
  it("meldet GDELT nicht, solange die Presse-Überwachung aus ist", () => {
    const v = regionViolations(externalConnections(env), { region: "DE", mentionMonitoring: false });
    expect(v.map((c) => c.id)).not.toContain("research-gdelt");
  });

  it("meldet GDELT, wenn die Presse-Überwachung im DE-Sub-Account läuft", () => {
    const v = regionViolations(externalConnections(env), { region: "DE", mentionMonitoring: true });
    expect(v.map((c) => c.id)).toContain("research-gdelt");
  });

  it("meldet GDELT nicht, wenn es per RESEARCH_GDELT=off abgeschaltet ist", () => {
    const v = regionViolations(externalConnections({ ...env, RESEARCH_GDELT: "off" }), { region: "DE", mentionMonitoring: true });
    expect(v.map((c) => c.id)).not.toContain("research-gdelt");
  });
});

describe("externalConnections – Vollständigkeit (Datenschutz-Durchsicht 2026-10-07)", () => {
  const full = {
    ...env,
    GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "x", MS_CLIENT_ID: "x", MS_CLIENT_SECRET: "x",
    LEXWARE_API_KEY: "x", S3_ENDPOINT: "https://object.storage.eu01.onstackit.cloud", S3_BUCKET: "b",
  };

  it("führt alle Dienste auf, an die personenbezogene Daten gehen können", () => {
    const ids = externalConnections(full).map((c) => c.id);
    for (const id of ["calendar-google", "calendar-microsoft", "lexware", "storage-s3", "webhooks", "inbox-imap"]) expect(ids).toContain(id);
  });

  it("Kalender-Anbieter (USA) sind nur aktiv, wenn eingerichtet, und dann ein Regionshinweis", () => {
    expect(externalConnections(env).find((c) => c.id === "calendar-google")?.active).toBe(false);
    const v = regionViolations(externalConnections(full), { region: "DE" }).map((c) => c.id);
    expect(v).toContain("calendar-google");
    expect(v).toContain("calendar-microsoft");
    expect(v).not.toContain("lexware");
    expect(v).not.toContain("storage-s3");
  });

  it("meldet im DE-Sub-Account ohne Presse-Überwachung keine Verstöße (SearXNG nur bei Nutzung)", () => {
    const v = regionViolations(externalConnections({ ...env, SEARXNG_URL: "http://127.0.0.1:58080" }), { region: "DE", mentionMonitoring: false });
    expect(v.map((c) => c.id)).toEqual([]);
  });

  it("meldet SearXNG im DE-Sub-Account, wenn die Presse-Überwachung läuft", () => {
    const v = regionViolations(externalConnections({ ...env, SEARXNG_URL: "http://127.0.0.1:58080" }), { region: "DE", mentionMonitoring: true });
    expect(v.map((c) => c.id)).toContain("searxng");
  });

  it("nennt als Ersatz nur Funktionen, die es gibt (kein ZUGFeRD)", () => {
    const all = externalConnections({ ...env, LEXWARE_API_KEY: "x" });
    expect(all.filter((c) => /zugferd/i.test(c.replaceable)).map((c) => c.id)).toEqual([]);
  });
});

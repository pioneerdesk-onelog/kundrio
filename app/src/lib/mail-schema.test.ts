import { describe, expect, it } from "vitest";
import { checkTransactional, senderDomainAllowed, webhookCreateSchema } from "./mail-schema";

const b64 = Buffer.from("%PDF-1.4 test").toString("base64");

// Echte Nutzlast-Formen der heutigen Brevo-Clients
const kompetenzanker = {
  sender: { email: "hallo@kompetenzanker.de", name: "Kompetenzanker" },
  to: [{ email: "lerner@example.com", name: "Lea" }],
  subject: "Bestätige deine E-Mail — Kompetenzanker",
  htmlContent: "<div><h2>Nur noch ein Klick</h2></div>",
  attachment: [{ name: "nachweis.pdf", content: b64 }],
};
const infercom = {
  sender: { name: "Infercom Router", email: "noreply@pioneerdesk.eu" },
  to: [{ email: "user@example.com" }],
  subject: "Ihr Code",
  textContent: "Code: 123456",
  htmlContent: "<div><p>Code: <strong>123456</strong></p></div>",
  tags: ["zitadel", "notification"],
};
const waechter = {
  sender: { name: "Verifact Wächter", email: "waechter@verifact.network" },
  to: [{ email: "a@example.com" }, { email: "b@example.com" }],
  subject: "Verifact Wächter: 2 Warnungen",
  textContent: "Bericht …",
};

describe("checkTransactional", () => {
  it.each([["Kompetenzanker", kompetenzanker], ["Infercom", infercom], ["Wächter", waechter]])("akzeptiert die Payload von %s", (_n, p) => {
    const r = checkTransactional(p);
    expect(r.ok).toBe(true);
  });

  it("dekodiert Anhänge und prüft Dateityp", () => {
    const r = checkTransactional(kompetenzanker);
    expect(r.ok && r.attachments[0]).toMatchObject({ filename: "nachweis.pdf", bytes: 13 });
    const bad = checkTransactional({ ...kompetenzanker, attachment: [{ name: "virus.exe", content: b64 }] });
    expect(bad).toMatchObject({ ok: false, code: "invalid_parameter" });
  });

  it("lehnt URL-Anhänge, messageVersions und sender.id ab", () => {
    expect(checkTransactional({ ...waechter, attachment: [{ name: "a.pdf", url: "http://169.254.169.254/" }] }).ok).toBe(false);
    expect(checkTransactional({ ...waechter, messageVersions: [{ to: [{ email: "x@y.de" }] }] }).ok).toBe(false);
    expect(checkTransactional({ ...waechter, sender: { id: 3 } }).ok).toBe(false);
  });

  it("verlangt Betreff und Inhalt, außer bei Vorlage", () => {
    expect(checkTransactional({ to: [{ email: "a@b.de" }], subject: "x" })).toMatchObject({ ok: false, code: "missing_parameter" });
    expect(checkTransactional({ to: [{ email: "a@b.de" }], htmlContent: "<p>x</p>" })).toMatchObject({ ok: false, message: "subject is missing" });
    expect(checkTransactional({ to: [{ email: "a@b.de" }], templateId: 3, params: { name: "x" } }).ok).toBe(true);
  });

  it("erlaubt nur eigene X-Header und bereinigt Zeilenumbrüche", () => {
    const ok = checkTransactional({ ...waechter, headers: { "X-Kunde": "4711\r\nBcc: evil@x.de", idempotencyKey: "abc" } });
    expect(ok.ok && ok.headers).toEqual({ "X-Kunde": "4711  Bcc: evil@x.de" });
    expect(checkTransactional({ ...waechter, headers: { Bcc: "evil@x.de" } }).ok).toBe(false);
    expect(checkTransactional({ ...waechter, headers: { "X-PD-Message-Id": "fake" } }).ok).toBe(false);
  });

  it("prüft scheduledAt (max. 72 h)", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    const r = checkTransactional({ ...waechter, scheduledAt: "2026-10-07T12:00:00Z" }, now);
    expect(r.ok && r.scheduledAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(checkTransactional({ ...waechter, scheduledAt: "2026-10-12T12:00:00Z" }, now).ok).toBe(false);
  });

  it("begrenzt Empfänger und Gesamtgröße der Anhänge", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ email: `u${i}@x.de` }));
    expect(checkTransactional({ ...waechter, to: many }).ok).toBe(false);
    const big = "A".repeat(14_000_000);
    expect(checkTransactional({ ...waechter, attachment: [{ name: "a.pdf", content: big }] }).ok).toBe(false);
  });
});

describe("senderDomainAllowed", () => {
  it("erlaubt Workspace-Domain, Subdomains und erlaubte Origins", () => {
    expect(senderDomainAllowed("hallo@kompetenzanker.de", "kompetenzanker.de", [])).toBe(true);
    expect(senderDomainAllowed("x@mail.kompetenzanker.de", "www.kompetenzanker.de", [])).toBe(true);
    expect(senderDomainAllowed("noreply@pioneerdesk.eu", "onelog.pro", ["https://pioneerdesk.eu"])).toBe(true);
    expect(senderDomainAllowed("x@evilkompetenzanker.de", "kompetenzanker.de", [])).toBe(false);
    expect(senderDomainAllowed("x@gmail.com", "kompetenzanker.de", [])).toBe(false);
  });
});

describe("webhookCreateSchema", () => {
  it("akzeptiert Brevo-Ereignisnamen und lehnt unbekannte ab", () => {
    expect(webhookCreateSchema.safeParse({ url: "https://x.de/h", events: ["delivered", "hardBounce"] }).success).toBe(true);
    expect(webhookCreateSchema.safeParse({ url: "https://x.de/h", events: ["boom"] }).success).toBe(false);
  });
});

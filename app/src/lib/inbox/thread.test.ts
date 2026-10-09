import { describe, expect, it } from "vitest";
import { bareEmail, emailThreadKey, isAutoReply, isSpam, normalizeMessageId, normalizePhone, normalizeSubject, parseReferences, relatedMessageIds, splitName } from "./thread";

describe("Thread-Zuordnung", () => {
  it("normalisiert Betreff-Präfixe (Re/AW/WG/Fwd, verschachtelt)", () => {
    expect(normalizeSubject("AW: WG: Re: Angebot Q4")).toBe("angebot q4");
    expect(normalizeSubject("Fwd:  [EXT]  Rechnung")).toContain("rechnung");
    expect(normalizeSubject(null)).toBe("");
  });
  it("Message-IDs einheitlich mit spitzen Klammern", () => {
    expect(normalizeMessageId(" <ABC@Example.org> ")).toBe("<ABC@Example.org>");
    expect(normalizeMessageId("abc@example.org")).toBe("<abc@example.org>");
    expect(normalizeMessageId("")).toBeNull();
    expect(parseReferences("<a@x> <b@x>\n <c@x>")).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });
  it("Thread-Schlüssel = Wurzel der References, sonst In-Reply-To, sonst eigene ID", () => {
    expect(emailThreadKey({ messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] })).toBe("<a@x>");
    expect(emailThreadKey({ messageId: "<c@x>", inReplyTo: "b@x" })).toBe("<b@x>");
    expect(emailThreadKey({ messageId: "c@x" })).toBe("<c@x>");
    expect(relatedMessageIds({ inReplyTo: "<b@x>", references: ["a@x", "<b@x>"] }).sort()).toEqual(["<a@x>", "<b@x>"]);
  });
  it("Adressen und Namen", () => {
    expect(bareEmail('"Max Muster" <Max@Firma.DE>')).toBe("max@firma.de");
    expect(splitName("Erika Mustermann")).toEqual({ firstName: "Erika", lastName: "Mustermann" });
  });
  it("Telefonnummern nach E.164", () => {
    expect(normalizePhone("0171 1234567")).toBe("+491711234567");
    expect(normalizePhone("+49 (0)171-1234567")).toBe("+491711234567");
    expect(normalizePhone("0043 660 1234567")).toBe("+436601234567");
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("Auto-Reply- und Spam-Erkennung", () => {
  it("erkennt Auto-Submitted und Abwesenheitsnotizen", () => {
    expect(isAutoReply({ "auto-submitted": "auto-replied" })).toBe(true);
    expect(isAutoReply({ "auto-submitted": "no" })).toBe(false);
    expect(isAutoReply({ "x-autoreply": "yes" })).toBe(true);
    expect(isAutoReply({ precedence: "bulk" })).toBe(true);
    expect(isAutoReply({}, "Automatische Antwort: Ihre Anfrage")).toBe(true);
    expect(isAutoReply({}, "Out of Office: bis 12.10.")).toBe(true);
    expect(isAutoReply({}, "Frage zur Rechnung", "MAILER-DAEMON@mx.example.org")).toBe(true);
    expect(isAutoReply({}, "Frage zur Rechnung", "kunde@example.org")).toBe(false);
  });
  it("erkennt Spam-Kennzeichen", () => {
    expect(isSpam({ "x-spam-flag": "YES" })).toBe(true);
    expect(isSpam({ "x-ms-exchange-organization-scl": "6" })).toBe(true);
    expect(isSpam({ "x-spam-status": "No, score=1.2" })).toBe(false);
  });
});

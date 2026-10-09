import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRawEmail } from "./channels/email-parse";

const fx = (n: string) => readFileSync(path.join(__dirname, "__fixtures__", n));

describe("RFC-822-Fixtures", () => {
  it("liest Antwort mit Thread-Bezug, Text/HTML und Anhang", async () => {
    const m = await parseRawEmail(fx("reply.eml"));
    expect(m.externalId).toBe("<reply-1@kunde.example>");
    expect(m.threadKey).toBe("<orig-1@agentur.example>");
    expect(m.from).toBe("erika@kunde.example");
    expect(m.fromName).toBe("Erika Mustermann");
    expect(m.subject).toBe("AW: Ihr Angebot");
    expect(m.text).toContain("Bitte Rechnung schicken");
    expect(m.html).toContain("<b>");
    expect(m.attachments?.map((a) => a.name)).toEqual(["notiz.txt"]);
    expect(m.flags?.autoReply).toBeFalsy();
  });
  it("kennzeichnet Abwesenheitsnotizen", async () => {
    const m = await parseRawEmail(fx("autoreply.eml"));
    expect(m.flags?.autoReply).toBe(true);
    expect(m.threadKey).toBe("<ooo-1@kunde.example>");
  });
  it("vergibt eine Ersatz-ID, wenn Message-ID fehlt", async () => {
    const m = await parseRawEmail("From: a@b.example\r\nSubject: x\r\n\r\nHallo", { fallbackId: "uid-42" });
    expect(m.externalId).toBe("<uid-42@inbox.local>");
    expect(m.text).toContain("Hallo");
  });
});

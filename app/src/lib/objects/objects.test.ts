import { describe, expect, it } from "vitest";
import { emailDomain, isFreemail, nameFromDomain, normalizeDomain } from "./domain";
import { DEFAULT_LIFECYCLE, isBackward } from "./lifecycle";

describe("normalizeDomain", () => {
  it("entfernt Protokoll, www, Pfad und Port", () => {
    expect(normalizeDomain("https://www.Example.de/pfad?x=1")).toBe("example.de");
    expect(normalizeDomain("WWW.example-agentur.de:443")).toBe("example-agentur.de");
    expect(normalizeDomain("sub.firma.co.uk")).toBe("sub.firma.co.uk");
  });
  it("lehnt Unsinn ab", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("keine domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("-bad-.de")).toBeNull();
  });
});

describe("emailDomain/isFreemail", () => {
  it("liest die Domain aus E-Mails", () => {
    expect(emailDomain("Max@Firma.DE")).toBe("firma.de");
    expect(emailDomain("kaputt")).toBeNull();
  });
  it("erkennt Freemailer", () => {
    for (const d of ["gmail.com", "gmx.de", "web.de", "t-online.de", "outlook.com", "icloud.com", "posteo.de", "mailbox.org", "proton.me"]) expect(isFreemail(d)).toBe(true);
    expect(isFreemail("example-agentur.de")).toBe(false);
  });
  it("schlägt Firmennamen vor", () => {
    expect(nameFromDomain("pioneer-desk.de")).toBe("Pioneer Desk");
  });
});

describe("Lifecycle", () => {
  const stages = DEFAULT_LIFECYCLE.map((s, i) => ({ ...s, position: i }));
  it("erkennt Rückschritte", () => {
    expect(isBackward(stages, "customer", "lead")).toBe(true);
    expect(isBackward(stages, "lead", "customer")).toBe(false);
    expect(isBackward(stages, "sql", "sql")).toBe(false);
  });
  it("behandelt other und Unbekanntes neutral", () => {
    expect(isBackward(stages, "customer", "other")).toBe(false);
    expect(isBackward(stages, "other", "lead")).toBe(false);
    expect(isBackward(stages, "x", "lead")).toBe(false);
    expect(isBackward(stages, null, "lead")).toBe(false);
  });
  it("hat HubSpot-Reihenfolge", () => {
    expect(DEFAULT_LIFECYCLE.map((s) => s.key)).toEqual(["subscriber", "lead", "mql", "sql", "opportunity", "customer", "evangelist", "other"]);
  });
});

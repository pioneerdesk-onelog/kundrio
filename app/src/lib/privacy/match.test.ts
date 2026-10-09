import { describe, expect, it } from "vitest";
import { addrRegex } from "./match";

// Gleiche Semantik wie Postgres „~*“ (POSIX, ohne Groß-/Kleinschreibung) für diese einfachen Muster
const hit = (value: string, field: string) => new RegExp(addrRegex(value), "i").test(field);

describe("addrRegex", () => {
  it("findet die Adresse allein, in spitzen Klammern und in Listen", () => {
    expect(hit("anna@x.de", "anna@x.de")).toBe(true);
    expect(hit("anna@x.de", '"Anna" <Anna@X.de>')).toBe(true);
    expect(hit("anna@x.de", "b@y.de, anna@x.de")).toBe(true);
  });
  it("findet keine Teiltreffer anderer Adressen", () => {
    expect(hit("anna@x.de", "joanna@x.de")).toBe(false);
    expect(hit("anna@x.de", "anna@x.de.evil")).toBe(false);
  });
  it("behandelt Sonderzeichen wörtlich (Punkt, Plus)", () => {
    expect(hit("a.b+c@x.de", "a.b+c@x.de")).toBe(true);
    expect(hit("a.b+c@x.de", "aXb+c@x.de")).toBe(false);
    expect(hit("+49151123", "+49151123")).toBe(true);
  });
});

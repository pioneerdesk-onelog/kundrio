import { describe, expect, it } from "vitest";
import { demoGuest, isDemoGuest, resolveLoginName } from "./demo";

// Testzugang 2026-10-09: Die Webseite nennt „guest“ / „lassmichrein“. Die Anmeldung verlangte eine E-Mail-Adresse,
// und jeder Gast hätte das Passwort ändern oder das Konto sperren können (Demo für alle anderen kaputt).
const demo = { DEMO_GUEST: "guest:guest@demo.kundrio.de" };

describe("Demo-Gastzugang", () => {
  it("Kurzname wird nur in der Demo zur E-Mail", () => {
    expect(resolveLoginName("Guest ", demo)).toBe("guest@demo.kundrio.de");
    expect(resolveLoginName("guest", {})).toBe("guest");
    expect(resolveLoginName("Max@Firma.de", demo)).toBe("max@firma.de");
  });
  it("ungültige Konfiguration schaltet die Demo aus", () => {
    expect(demoGuest({ DEMO_GUEST: "guest" })).toBeNull();
    expect(demoGuest({ DEMO_GUEST: ":x@y.de" })).toBeNull();
  });
  it("erkennt das geschützte Gastkonto", () => {
    expect(isDemoGuest("GUEST@demo.kundrio.de", demo)).toBe(true);
    expect(isDemoGuest("guest@demo.kundrio.de", {})).toBe(false);
  });
});

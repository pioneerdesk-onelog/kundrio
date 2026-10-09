import { describe, expect, it } from "vitest";
import { assocIds, centsFromAmount, companyAddress, customValues, dealStageKind, hasConsentBasis, mapLifecycle, mapPriority, mapPropertyType, stripHtml, ticketStageKind } from "./hubspot-map";

describe("HubSpot-Mapping", () => {
  it("Lifecycle", () => {
    expect(mapLifecycle("marketingqualifiedlead")).toBe("mql");
    expect(mapLifecycle("salesqualifiedlead")).toBe("sql");
    expect(mapLifecycle("customer")).toBe("customer");
    expect(mapLifecycle("123456")).toBe("other");
    expect(mapLifecycle("")).toBeNull();
    expect(mapLifecycle(undefined)).toBeNull();
  });
  it("Priorität und Typen", () => {
    expect(mapPriority("HIGH")).toBe("high");
    expect(mapPriority(null)).toBe("medium");
    expect(mapPropertyType("enumeration", "booleancheckbox")).toBe("boolean");
    expect(mapPropertyType("enumeration", "select")).toBe("select");
    expect(mapPropertyType("datetime")).toBe("date");
    expect(mapPropertyType("string")).toBe("text");
  });
  it("Beträge", () => {
    expect(centsFromAmount("1234.5")).toBe(123450);
    expect(centsFromAmount("abc")).toBe(0);
    expect(centsFromAmount(null)).toBe(0);
  });
  it("Phasen-Arten", () => {
    expect(dealStageKind({ id: "a", label: "Gewonnen", metadata: { isClosed: "true", probability: "1.0" } })).toBe("WON");
    expect(dealStageKind({ id: "b", label: "Verloren", metadata: { isClosed: "true", probability: "0.0" } })).toBe("LOST");
    expect(dealStageKind({ id: "c", label: "Offen", metadata: { isClosed: "false", probability: "0.2" } })).toBe("OPEN");
    expect(ticketStageKind({ id: "d", label: "Geschlossen", metadata: { ticketState: "CLOSED" } })).toBe("CLOSED");
    expect(ticketStageKind({ id: "e", label: "Neu", metadata: { ticketState: "OPEN" } })).toBe("OPEN");
  });
  it("Einwilligung nur wenn belegt", () => {
    expect(hasConsentBasis("Freely given consent from contact")).toBe(true);
    expect(hasConsentBasis("Legitimate interest – existing customer")).toBe(false);
    expect(hasConsentBasis(null)).toBe(false);
  });
  it("Eigene Felder und Hilfen", () => {
    const v = customValues({ branche: "IT", score: "12", vip: "true", leer: "" }, [
      { name: "branche", type: "text" }, { name: "score", type: "number" }, { name: "vip", type: "boolean" }, { name: "leer", type: "text" },
    ]);
    expect(v).toEqual({ branche: "IT", score: 12, vip: true });
    expect(stripHtml("<p>Hallo&nbsp;<b>Welt</b></p><p>2</p>")).toBe("Hallo Welt\n2");
    expect(companyAddress({ address: "Hauptstr. 1", zip: "85368", city: "Moosburg", country: "Germany" })).toBe("Hauptstr. 1\n85368 Moosburg\nGermany");
    expect(assocIds({ associations: { companies: { results: [{ id: 5 }, { id: "6" }] } } }, "companies")).toEqual(["5", "6"]);
    expect(assocIds({}, "companies")).toEqual([]);
  });
});

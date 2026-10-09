import { describe, expect, it } from "vitest";
import { computeTotals, nextNumber, parseAddress, roundHalfAwayFromZero } from "./invoice";
import { buildXRechnung, xrechnungMissing } from "./xrechnung";
import { epcPayload } from "./epc";

const items = [
  { title: "Beratung", qty: 1.5, unitCents: 12000, vatRate: 19 as const, unit: "HUR" as const },
  { title: "Buch", qty: 3, unitCents: 1999, vatRate: 7 as const, unit: "C62" as const },
  { title: "Lizenz <A&B>", qty: 1, unitCents: 3333, vatRate: 19 as const, unit: "C62" as const },
];

describe("Rechnungsberechnung", () => {
  it("rundet kaufmännisch", () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(0.1 * 3 * 100)).toBe(30);
  });
  it("summiert je Steuersatz", () => {
    const t = computeTotals(items);
    expect(t.netCents).toBe(18000 + 5997 + 3333);
    const g19 = t.vatGroups.find((g) => g.rate === 19)!;
    expect(g19.netCents).toBe(21333);
    expect(g19.vatCents).toBe(4053); // 4053,27 → 4053
    expect(t.vatGroups.find((g) => g.rate === 7)!.vatCents).toBe(420); // 419,79 → 420
    expect(t.grossCents).toBe(t.netCents + 4053 + 420);
  });
  it("vergibt fortlaufende Nummern", () => {
    expect(nextNumber("INVOICE", 2026, null)).toBe("RE-2026-0001");
    expect(nextNumber("INVOICE", 2026, "RE-2026-0041")).toBe("RE-2026-0042");
    expect(nextNumber("QUOTE", 2027, "AN-2026-0099")).toBe("AN-2027-0001");
  });
  it("zerlegt Adressen", () => {
    expect(parseAddress("Musterstraße 1\n85368 Moosburg\nDE")).toEqual({ street: "Musterstraße 1", zip: "85368", city: "Moosburg", country: "DE" });
  });
});

describe("XRechnung", () => {
  const input = {
    number: "RE-2026-0001",
    issueDate: new Date("2026-10-06"),
    dueDate: new Date("2026-10-20"),
    currency: "EUR",
    buyerReference: "04011000-12345-34",
    items,
    seller: { name: "Pioneerdesk GmbH", address: "Musterstraße 1\n85368 Moosburg", vatId: "DE123456789", email: "rechnung@example.com", contactName: "Buchhaltung", phone: "+49 123 4567", iban: "DE89370400440532013000", bic: "COBADEFFXXX" },
    buyer: { name: "Kunde AG", address: "Weg 2, 80331 München", email: "ap@example.org" },
  };
  it("enthält Pflichtelemente und korrekte Summen", () => {
    const xml = buildXRechnung(input);
    expect(xml).toContain("urn:xeinkauf.de:kosit:xrechnung_3.0");
    expect(xml).toContain("<cbc:ID>RE-2026-0001</cbc:ID>");
    expect(xml).toContain("<cbc:BuyerReference>04011000-12345-34</cbc:BuyerReference>");
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">318.03</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">44.73</cbc:TaxAmount>');
    expect(xml).toContain("Lizenz &lt;A&amp;B&gt;");
    expect((xml.match(/<cac:InvoiceLine>/g) ?? []).length).toBe(3);
    expect(xml).not.toMatch(/<A&B>/);
  });
  it("meldet fehlende Pflichtangaben", () => {
    expect(xrechnungMissing(input)).toEqual([]);
    expect(xrechnungMissing({ ...input, buyerReference: "", seller: { ...input.seller, phone: null } })).toHaveLength(2);
  });
  it("verlangt Befreiungsgrund bei 0 % und gibt ihn aus", () => {
    const zero = { ...input, items: [...items, { title: "Schulung", qty: 1, unitCents: 50000, vatRate: 0 as const, unit: "C62" as const }] };
    expect(xrechnungMissing(zero)).toEqual(["Grund der Steuerbefreiung bei 0 % (BT-120)"]);
    const xml = buildXRechnung({ ...zero, taxExemptionReason: "Steuerfrei nach § 4 Nr. 21 UStG" });
    expect(xml).toContain("<cbc:TaxExemptionReason>Steuerfrei nach § 4 Nr. 21 UStG</cbc:TaxExemptionReason>");
  });
  it("gibt Leistungszeitraum statt Leistungsdatum aus", () => {
    const xml = buildXRechnung({ ...input, servicePeriod: { from: new Date("2026-09-01"), to: new Date("2026-09-30") } });
    expect(xml).toContain("<cac:InvoicePeriod><cbc:StartDate>2026-09-01</cbc:StartDate><cbc:EndDate>2026-09-30</cbc:EndDate></cac:InvoicePeriod>");
    expect(xml).not.toContain("ActualDeliveryDate");
    // UBL-Reihenfolge: InvoicePeriod nach BuyerReference, vor AccountingSupplierParty
    expect(xml.indexOf("InvoicePeriod")).toBeGreaterThan(xml.indexOf("BuyerReference"));
    expect(xml.indexOf("InvoicePeriod")).toBeLessThan(xml.indexOf("AccountingSupplierParty"));
    expect(xrechnungMissing({ ...input, servicePeriod: { from: new Date("2026-09-30"), to: new Date("2026-09-01") } })).toHaveLength(1);
  });
  it("enthält ohne Zeitraum das Leistungsdatum", () => {
    expect(buildXRechnung(input)).toContain("<cbc:ActualDeliveryDate>2026-10-06</cbc:ActualDeliveryDate>");
  });
});

describe("EPC-QR", () => {
  it("erzeugt gültige Nutzlast", () => {
    const p = epcPayload({ name: "Pioneerdesk GmbH", iban: "DE89 3704 0044 0532 0130 00", bic: "COBADEFFXXX", amountCents: 33803, text: "RE-2026-0001" });
    expect(p.split("\n")).toEqual(["BCD", "002", "1", "SCT", "COBADEFFXXX", "Pioneerdesk GmbH", "DE89370400440532013000", "EUR338.03", "", "", "RE-2026-0001"]);
  });
  it("lehnt falsche IBAN ab", () => {
    expect(() => epcPayload({ name: "X", iban: "DE00", amountCents: 100, text: "" })).toThrow();
  });
});

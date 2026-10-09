import { describe, expect, it } from "vitest";
import { companyToLexware, invoiceToLexware, lexwareToLocal, mapVoucherStatus, parseAddress, personToLexware } from "./mapping";

const base = {
  kind: "INVOICE",
  number: "RE-2026-0007",
  issueDate: new Date("2026-10-07T00:00:00Z"),
  dueDate: null,
  currency: "EUR",
  buyerName: "Muster Maschinenbau GmbH",
  buyerAddress: "Industriestraße 12\n85368 Moosburg",
  serviceFrom: null,
  serviceTo: null,
  taxExemptionReason: null,
  notes: null,
};

describe("Adresse", () => {
  it("erkennt Straße, PLZ, Ort", () => {
    expect(parseAddress("Industriestraße 12\n85368 Moosburg a.d. Isar")).toEqual({ street: "Industriestraße 12", zip: "85368", city: "Moosburg a.d. Isar", countryCode: "DE" });
    expect(parseAddress("Hauptplatz 1, 1010 Wien", "AT")).toEqual({ street: "Hauptplatz 1", zip: "1010", city: "Wien", countryCode: "AT" });
    expect(parseAddress(null)).toEqual({ countryCode: "DE" });
  });
});

describe("Rechnung → Lexware", () => {
  it("Positionen netto je Einheit in Euro, USt 19/7, Entwurf mit Leistungsdatum", () => {
    const p = invoiceToLexware({
      ...base,
      items: [
        { title: "Champion-Track", qty: 5, unitCents: 149000, vatRate: 19, unit: "C62" },
        { title: "Lernmaterial", qty: 3, unitCents: 1999, vatRate: 7, unit: "C62" },
        { title: "Beratung", qty: 1.5, unitCents: 12000, vatRate: 19, unit: "HUR" },
      ],
    }, null);
    expect(p.lineItems.map((l) => [l.unitPrice.netAmount, l.unitPrice.taxRatePercentage, l.quantity, l.unitName])).toEqual([
      [1490, 19, 5, "Stück"],
      [19.99, 7, 3, "Stück"],
      [120, 19, 1.5, "Stunde"],
    ]);
    expect(p.taxConditions).toEqual({ taxType: "net" });
    expect(p.shippingConditions).toEqual({ shippingType: "service", shippingDate: "2026-10-07T00:00:00.000Z" });
    expect(p.address).toEqual({ name: "Muster Maschinenbau GmbH", street: "Industriestraße 12", zip: "85368", city: "Moosburg", countryCode: "DE" });
    expect(p.introduction).toContain("RE-2026-0007");
  });
  it("nur 0 % → steuerfrei mit Begründung; Leistungszeitraum", () => {
    const p = invoiceToLexware({
      ...base,
      taxExemptionReason: "Steuerfrei nach § 4 Nr. 21 UStG",
      serviceFrom: new Date("2026-09-01T00:00:00Z"),
      serviceTo: new Date("2026-09-30T00:00:00Z"),
      items: [{ title: "Schulung", qty: 1, unitCents: 99000, vatRate: 0, unit: "DAY" }],
    }, "lex-123");
    expect(p.taxConditions).toEqual({ taxType: "vatfree", taxTypeNote: "Steuerfrei nach § 4 Nr. 21 UStG" });
    expect(p.shippingConditions?.shippingType).toBe("serviceperiod");
    expect(p.address).toEqual({ contactId: "lex-123" });
  });
  it("Angebot: Ablaufdatum statt Lieferbedingung", () => {
    const p = invoiceToLexware({ ...base, kind: "QUOTE", items: [{ title: "X", qty: 1, unitCents: 100, vatRate: 19, unit: "C62" }] }, null);
    expect(p.shippingConditions).toBeUndefined();
    expect(p.expirationDate).toBe("2026-11-06T00:00:00.000Z");
    expect(p.title).toBe("Angebot");
  });
  it("lehnt leere Belege und fehlenden Käufer ab", () => {
    expect(() => invoiceToLexware({ ...base, items: [] }, null)).toThrow(/Positionen/);
    expect(() => invoiceToLexware({ ...base, buyerName: null, items: [{ title: "X", qty: 1, unitCents: 1, vatRate: 19, unit: "C62" }] }, null)).toThrow(/Käufer/);
  });
});

describe("Kontakte", () => {
  it("Unternehmen mit Ansprechpartner", () => {
    const p = companyToLexware({ name: "Muster GmbH", phone: "+49 8761 1", address: "Weg 1\n80331 München", website: "https://muster.de" }, { firstName: "Anna", lastName: "Muster", email: "anna@muster.de", phone: null, company: null });
    expect(p.roles).toEqual({ customer: {} });
    expect(p.company?.contactPersons?.[0]).toMatchObject({ lastName: "Muster", firstName: "Anna", emailAddress: "anna@muster.de", primary: true });
    expect(p.addresses?.billing[0].zip).toBe("80331");
  });
  it("Person ohne Nachnamen nutzt E-Mail-Präfix, ohne beides Fehler", () => {
    expect(personToLexware({ firstName: null, lastName: null, email: "kai@example.com", phone: null, company: null }).person?.lastName).toBe("kai");
    expect(() => personToLexware({ firstName: "A", lastName: null, email: null, phone: null, company: null })).toThrow();
  });
  it("Import aus Lexware", () => {
    expect(lexwareToLocal({ id: "1", version: 2, company: { name: "Acme", contactPersons: [{ lastName: "Roe", emailAddress: "J@Acme.de" }] } })).toMatchObject({ kind: "company", companyName: "Acme", contact: { email: "j@acme.de" } });
    expect(lexwareToLocal({ id: "2", version: 0, person: { lastName: "Doe" }, emailAddresses: { private: ["d@x.de"] } })).toMatchObject({ kind: "person", contact: { lastName: "Doe", email: "d@x.de" } });
  });
  it("Status-Abbildung", () => {
    expect(mapVoucherStatus("INVOICE", "paid")).toBe("PAID");
    expect(mapVoucherStatus("INVOICE", "open")).toBeNull();
    expect(mapVoucherStatus("QUOTE", "accepted")).toBe("ACCEPTED");
    expect(mapVoucherStatus("INVOICE", "voided")).toBe("CANCELLED");
  });
});

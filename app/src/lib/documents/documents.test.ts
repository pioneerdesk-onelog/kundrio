import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-123";
process.env.APP_URL ||= "http://127.0.0.1:3100";

import { invoicePrefix, nextNumber, KIND_LABEL } from "../invoice";
import { DEFAULT_TEXTS, buildDocContext, renderDocText, resolveTexts, unknownPlaceholders, TEXT_FIELDS } from "./texts";
import { acceptToken, verifyAcceptToken } from "./accept-token";
import { renderDocumentPdf, winAnsi } from "./pdf";
import { invoiceToLexware } from "../lexware/mapping";
import { inflateSync } from "node:zlib";

/** Inhalte aller (ggf. Flate-komprimierten) Streams eines PDFs als Text (latin1). */
function pdfStreams(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const chunk = buf.subarray(start, end);
    try {
      out += inflateSync(chunk).toString("latin1");
    } catch {
      out += chunk.toString("latin1");
    }
    re.lastIndex = end;
  }
  return out;
}

const doc = {
  kind: "ORDER",
  number: "AB-2026-0007",
  issueDate: new Date("2026-10-07T00:00:00Z"),
  dueDate: null,
  serviceFrom: new Date("2026-11-01T00:00:00Z"),
  serviceTo: new Date("2026-11-30T00:00:00Z"),
  netCents: 150000,
  grossCents: 178500,
  currency: "EUR",
  buyerName: "Muster & Söhne GmbH",
  customerOrderRef: "PO-4711",
};

describe("Nummernkreis Auftragsbestätigung", () => {
  it("vergibt AB-JJJJ-0001 fortlaufend und getrennt von AN/RE", () => {
    expect(invoicePrefix("ORDER", 2026)).toBe("AB-2026-");
    expect(nextNumber("ORDER", 2026, null)).toBe("AB-2026-0001");
    expect(nextNumber("ORDER", 2026, "AB-2026-0041")).toBe("AB-2026-0042");
    // Nummer eines anderen Jahres/Kreises zählt nicht weiter
    expect(nextNumber("ORDER", 2027, "AB-2026-0041")).toBe("AB-2027-0001");
    expect(nextNumber("ORDER", 2026, "RE-2026-0099")).toBe("AB-2026-0001");
    expect(KIND_LABEL.ORDER).toBe("Auftragsbestätigung");
  });
});

describe("Dokumenttexte & Platzhalter", () => {
  const ctx = buildDocContext(doc, { firstName: "Erika", lastName: "Muster", company: "Muster & Söhne GmbH" }, { companyName: "Pioneerdesk GmbH", userName: "Marcus Lenczyk" });

  it("ersetzt Platzhalter und nutzt Standardwerte bei fehlenden Angaben", () => {
    expect(renderDocText("AB {{ dokument.nummer }} für {{ kunde.ansprechpartner }}", ctx)).toBe("AB AB-2026-0007 für Erika Muster");
    expect(renderDocText('Hallo {{ kunde.titel | default: "zusammen" }}', ctx)).toBe("Hallo zusammen");
    expect(renderDocText("{{ dokument.kundenreferenz_text }}", ctx)).toBe(" (Ihre Bestellung PO-4711)");
    expect(renderDocText("{{ dokument.summe_brutto }}", ctx)).toMatch(/1\.785,00\s€/);
    expect(renderDocText("{{ dokument.leistungszeitraum }}", ctx)).toContain("–");
  });

  it("escaped Werte im HTML, nicht im Text", () => {
    expect(renderDocText("{{ kunde.name }}", ctx, { html: true })).toBe("Muster &amp; Söhne GmbH");
    expect(renderDocText("{{ kunde.name }}", ctx)).toBe("Muster & Söhne GmbH");
    const evil = buildDocContext({ ...doc, buyerName: "<script>x</script>" }, null, { companyName: "X" });
    expect(renderDocText("{{ kunde.name }}", evil, { html: true })).not.toContain("<script>");
  });

  it("erkennt unbekannte Platzhalter; Standardtexte enthalten nur bekannte", () => {
    expect(unknownPlaceholders("{{ kunde.name }} {{ kunde.iban }} {{params.x}}")).toEqual(["kunde.iban", "params.x"]);
    for (const k of ["QUOTE", "ORDER", "INVOICE"] as const) for (const f of TEXT_FIELDS) expect(unknownPlaceholders(DEFAULT_TEXTS[k][f])).toEqual([]);
  });

  it("Bezahllink: nur mit Link sichtbar, Alias {{ invoice.paymentLink }}", () => {
    const url = "https://app.example/zahlung/tok";
    const withLink = buildDocContext(doc, null, { companyName: "X" }, { paymentUrl: url });
    expect(renderDocText("{{ dokument.zahlungslink }}", withLink)).toBe(url);
    expect(renderDocText("{{ invoice.paymentLink }}", withLink)).toBe(url);
    expect(renderDocText('{{ invoice.paymentLink | default: "–" }}', ctx)).toBe("–");
    expect(renderDocText("A.{{ dokument.zahlungslink_text }}", withLink)).toContain(`online bezahlen: ${url}`);
    expect(renderDocText("A.{{ dokument.zahlungslink_text }}", ctx)).toBe("A.");
    // Standard-Mail der Rechnung: ohne Anbieter kein Hinweis, mit Anbieter der Link
    expect(renderDocText(DEFAULT_TEXTS.INVOICE.emailBody, ctx)).not.toContain("online bezahlen");
    expect(renderDocText(DEFAULT_TEXTS.INVOICE.emailBody, withLink)).toContain(url);
    expect(unknownPlaceholders("{{ invoice.paymentLink }}")).toEqual([]);
  });

  it("führt gespeicherte Texte mit Standardtexten zusammen", () => {
    const r = resolveTexts({ ORDER: { intro: "Eigener Text", outro: "  " } });
    expect(r.ORDER.intro).toBe("Eigener Text");
    expect(r.ORDER.outro).toBe(DEFAULT_TEXTS.ORDER.outro); // leer → Standard
    expect(r.QUOTE).toEqual(DEFAULT_TEXTS.QUOTE);
    expect(resolveTexts(null).INVOICE).toEqual(DEFAULT_TEXTS.INVOICE);
  });
});

describe("Annahme-Link", () => {
  it("ist gültig, manipulationssicher und läuft ab", () => {
    const now = Date.now();
    const t = acceptToken("cmabc1234567890", new Date(now + 5 * 864e5), now);
    expect(verifyAcceptToken(t, now)?.invoiceId).toBe("cmabc1234567890");
    const [id, exp, sig] = t.split(".");
    expect(verifyAcceptToken(`cmxyz1234567890.${exp}.${sig}`, now)).toBeNull();
    expect(verifyAcceptToken(`${id}.${Number(exp) + 1000}.${sig}`, now)).toBeNull();
    expect(verifyAcceptToken(t, Number(exp) + 1)).toBeNull();
    // höchstens 90 Tage, mindestens 1 Tag
    const long = acceptToken("cmabc1234567890", new Date(now + 400 * 864e5), now);
    expect(Number(long.split(".")[1])).toBeLessThanOrEqual(now + 90 * 864e5);
  });
});

describe("PDF", () => {
  const hex = (s: string) => Buffer.from(winAnsi(s), "latin1").toString("hex").toUpperCase();
  it("enthält Belegnummer, Titel und Summe (Helvetica/WinAnsi)", async () => {
    const bytes = await renderDocumentPdf(
      { ...doc, status: "DRAFT", buyerAddress: "Hauptstr. 1\n80331 München", buyerReference: null, taxExemptionReason: null, notes: "Hinweis", items: [{ title: "Beratung", qty: 10, unitCents: 15000, vatRate: 19, unit: "HUR" }] },
      { name: "Pioneerdesk GmbH", address: "Teststr. 1\n85368 Moosburg", phone: null, email: "info@example.com", domain: "example.com", vatId: "DE123456789", iban: null, bic: null, brandPrimary: "#0B4F6C" },
      { intro: "Vielen Dank für Ihren Auftrag.", outro: "Mit freundlichen Grüßen", paymentTerms: "Zahlbar in 14 Tagen." },
    );
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    const body = pdfStreams(bytes).toUpperCase();
    expect(body).toContain(hex("AB-2026-0007"));
    expect(body).toContain(hex("Auftragsbestätigung AB-2026-0007"));
    expect(body).toContain(hex("1.785,00")); // Bruttosumme
    expect(body).toContain(hex("Ihre Bestellung"));
  });
  it("ersetzt Zeichen außerhalb von WinAnsi statt abzubrechen", () => {
    expect(winAnsi("„Test“ – 😀")).toBe('"Test" - ?');
  });
});

describe("Lexware-Mapping Auftragsbestätigung", () => {
  it("setzt Titel, Zahlungs- und Lieferbedingungen", () => {
    const p = invoiceToLexware(
      { kind: "ORDER", number: "AB-2026-0001", issueDate: doc.issueDate, dueDate: null, currency: "EUR", items: [{ title: "Beratung", qty: 2, unitCents: 10000, vatRate: 7, unit: "C62" }], buyerName: "Muster GmbH", buyerAddress: "Hauptstr. 1\n80331 München", serviceFrom: doc.serviceFrom, serviceTo: doc.serviceTo, taxExemptionReason: null, notes: null },
      null,
    );
    expect(p.title).toBe("Auftragsbestätigung");
    expect(p.paymentConditions).toEqual({ paymentTermLabel: expect.any(String), paymentTermDuration: 14 });
    expect(p.shippingConditions?.shippingType).toBe("serviceperiod");
    expect(p.expirationDate).toBeUndefined();
    expect(p.lineItems[0].unitPrice.taxRatePercentage).toBe(7);
  });
});

import { computeTotals, parseAddress, UNIT_LABEL, type InvoiceItem, lineNetCents } from "./invoice";

// XRechnung 3.0 (CIUS von EN 16931) in UBL 2.1-Syntax.
// Hinweis: Ergebnis vor produktivem Einsatz mit dem KoSIT-Validator prüfen.

export type XRechnungInput = {
  number: string;
  issueDate: Date;
  dueDate?: Date | null;
  deliveryDate?: Date | null;
  /** Leistungszeitraum (BT-73/74). Ohne Zeitraum gilt das Leistungsdatum (BT-72). */
  servicePeriod?: { from: Date; to: Date } | null;
  /** Grund der Steuerbefreiung (BT-120), Pflicht bei Positionen mit 0 % */
  taxExemptionReason?: string | null;
  currency: string;
  buyerReference: string;
  notes?: string | null;
  items: InvoiceItem[];
  seller: { name: string; address: string; vatId: string; email: string; contactName: string; phone?: string | null; iban: string; bic?: string | null };
  buyer: { name: string; address: string; email: string };
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const day = (d: Date) => d.toISOString().slice(0, 10);
const amt = (cents: number) => (cents / 100).toFixed(2);

function taxCategory(rate: number) {
  return rate > 0 ? "S" : "E";
}

function address(text: string) {
  const a = parseAddress(text);
  return `<cac:PostalAddress>${a.street ? `<cbc:StreetName>${esc(a.street)}</cbc:StreetName>` : ""}${a.city ? `<cbc:CityName>${esc(a.city)}</cbc:CityName>` : ""}${a.zip ? `<cbc:PostalZone>${esc(a.zip)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${a.country}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
}

export function xrechnungMissing(input: Partial<XRechnungInput>): string[] {
  const m: string[] = [];
  if (!input.buyerReference) m.push("Käuferreferenz/Leitweg-ID (BT-10)");
  if (!input.seller?.name) m.push("Firmenname (BT-27)");
  if (!input.seller?.address || !parseAddress(input.seller.address).city) m.push("Firmenanschrift mit PLZ/Ort (BG-5)");
  if (!input.seller?.vatId) m.push("USt-IdNr. (BT-31)");
  if (!input.seller?.email) m.push("Absender-E-Mail (BT-34/BT-43)");
  if (!input.seller?.phone) m.push("Telefon des Verkäufers (BT-42, Pflicht in XRechnung)");
  if (!input.seller?.iban) m.push("IBAN (BT-84)");
  if (!input.buyer?.name) m.push("Name des Käufers (BT-44)");
  if (!input.buyer?.email) m.push("E-Mail des Käufers (BT-49)");
  if (!input.buyer?.address || !parseAddress(input.buyer.address).city) m.push("Käuferanschrift mit PLZ/Ort (BG-8)");
  if (!input.items?.length) m.push("mindestens eine Position");
  if (input.items?.some((it) => it.vatRate === 0) && !input.taxExemptionReason?.trim()) {
    m.push("Grund der Steuerbefreiung bei 0 % (BT-120)");
  }
  if (input.servicePeriod && input.servicePeriod.to < input.servicePeriod.from) m.push("Leistungszeitraum: Ende vor Beginn (BT-73/74)");
  return m;
}

export function buildXRechnung(x: XRechnungInput): string {
  const t = computeTotals(x.items);
  const cur = esc(x.currency);
  const taxSubtotals = t.vatGroups
    .map(
      (g) =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${cur}">${amt(g.netCents)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${cur}">${amt(g.vatCents)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${taxCategory(g.rate)}</cbc:ID><cbc:Percent>${g.rate}</cbc:Percent>${g.rate === 0 ? `<cbc:TaxExemptionReason>${esc(x.taxExemptionReason?.trim() || "Steuerbefreit")}</cbc:TaxExemptionReason>` : ""}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`,
    )
    .join("");
  const lines = x.items
    .map(
      (it, i) =>
        `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="${it.unit}">${it.qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${cur}">${amt(lineNetCents(it))}</cbc:LineExtensionAmount><cac:Item><cbc:Description>${esc(`${it.qty} ${UNIT_LABEL[it.unit]}`)}</cbc:Description><cbc:Name>${esc(it.title)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${taxCategory(it.vatRate)}</cbc:ID><cbc:Percent>${it.vatRate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${cur}">${(it.unitCents / 100).toFixed(2)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${esc(x.number)}</cbc:ID>
<cbc:IssueDate>${day(x.issueDate)}</cbc:IssueDate>
${x.dueDate ? `<cbc:DueDate>${day(x.dueDate)}</cbc:DueDate>` : ""}
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
${x.notes ? `<cbc:Note>${esc(x.notes)}</cbc:Note>` : ""}
<cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
<cbc:BuyerReference>${esc(x.buyerReference)}</cbc:BuyerReference>
${x.servicePeriod ? `<cac:InvoicePeriod><cbc:StartDate>${day(x.servicePeriod.from)}</cbc:StartDate><cbc:EndDate>${day(x.servicePeriod.to)}</cbc:EndDate></cac:InvoicePeriod>` : ""}
<cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="EM">${esc(x.seller.email)}</cbc:EndpointID><cac:PartyName><cbc:Name>${esc(x.seller.name)}</cbc:Name></cac:PartyName>${address(x.seller.address)}<cac:PartyTaxScheme><cbc:CompanyID>${esc(x.seller.vatId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${esc(x.seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity><cac:Contact><cbc:Name>${esc(x.seller.contactName)}</cbc:Name>${x.seller.phone ? `<cbc:Telephone>${esc(x.seller.phone)}</cbc:Telephone>` : ""}<cbc:ElectronicMail>${esc(x.seller.email)}</cbc:ElectronicMail></cac:Contact></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cbc:EndpointID schemeID="EM">${esc(x.buyer.email)}</cbc:EndpointID>${address(x.buyer.address)}<cac:PartyLegalEntity><cbc:RegistrationName>${esc(x.buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
${x.servicePeriod ? "" : `<cac:Delivery><cbc:ActualDeliveryDate>${day(x.deliveryDate ?? x.issueDate)}</cbc:ActualDeliveryDate></cac:Delivery>`}
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>${esc(x.number)}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${esc(x.seller.iban.replace(/\s+/g, ""))}</cbc:ID><cbc:Name>${esc(x.seller.name)}</cbc:Name>${x.seller.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${esc(x.seller.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ""}</cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:PaymentTerms><cbc:Note>${x.dueDate ? `Zahlbar bis ${day(x.dueDate)} ohne Abzug.` : "Zahlbar sofort ohne Abzug."}</cbc:Note></cac:PaymentTerms>
<cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${amt(t.vatCents)}</cbc:TaxAmount>${taxSubtotals}</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${cur}">${amt(t.netCents)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="${cur}">${amt(t.netCents)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${cur}">${amt(t.grossCents)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${cur}">${amt(t.grossCents)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines}
</ubl:Invoice>
`.replace(/\n\n+/g, "\n");
}

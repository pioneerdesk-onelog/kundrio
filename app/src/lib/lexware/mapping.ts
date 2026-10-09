import { parseItems, type InvoiceItem } from "../invoice";

// Reine Umwandlung CRM ↔ Lexware (ohne DB, testbar). Beträge: CRM in Cent, Lexware in Euro (netto je Einheit).

const UNIT_NAMES: Record<InvoiceItem["unit"], string> = { C62: "Stück", HUR: "Stunde", DAY: "Tag", MON: "Monat" };

export type ParsedAddress = { street?: string; zip?: string; city?: string; countryCode: string };

/** "Musterweg 2\n80331 München" → Straße/PLZ/Ort. Unbekanntes bleibt leer statt geraten. */
export function parseAddress(raw: string | null | undefined, countryCode = "DE"): ParsedAddress {
  const lines = (raw ?? "").split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);
  const out: ParsedAddress = { countryCode };
  const zipIdx = lines.findIndex((l) => /^\d{4,5}\s+\S/.test(l));
  if (zipIdx >= 0) {
    const m = lines[zipIdx].match(/^(\d{4,5})\s+(.+)$/)!;
    out.zip = m[1];
    out.city = m[2];
    const street = lines.slice(0, zipIdx).filter((l) => /\d/.test(l)).pop() ?? lines[zipIdx - 1];
    if (street) out.street = street;
  } else if (lines.length) {
    out.street = lines[0];
  }
  return out;
}

const euro = (cents: number) => Math.round(cents) / 100;

/** ISO-Datum (Lexware erwartet Datum+Uhrzeit mit Zeitzone). */
export const lexDate = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();

export type InvoiceLike = {
  kind: string;
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  items: unknown;
  buyerName: string | null;
  buyerAddress: string | null;
  serviceFrom: Date | null;
  serviceTo: Date | null;
  taxExemptionReason: string | null;
  notes: string | null;
};

export type LexwareVoucherPayload = {
  voucherDate: string;
  expirationDate?: string;
  address: { contactId: string } | { name: string; street?: string; zip?: string; city?: string; countryCode: string };
  lineItems: {
    type: "custom";
    name: string;
    quantity: number;
    unitName: string;
    unitPrice: { currency: string; netAmount: number; taxRatePercentage: number };
    discountPercentage: number;
  }[];
  totalPrice: { currency: string };
  taxConditions: { taxType: "net" | "vatfree"; taxTypeNote?: string };
  shippingConditions?: { shippingType: "service" | "serviceperiod"; shippingDate: string; shippingEndDate?: string };
  // Auftragsbestätigung (Pflichtfeld laut API) bzw. Rechnung
  paymentConditions?: { paymentTermLabel: string; paymentTermDuration: number };
  title: string;
  introduction?: string;
  remark?: string;
};

/**
 * CRM-Beleg → Lexware-Rechnung bzw. -Angebot (Entwurf). `contactId` = Lexware-Kontakt, falls zugeordnet,
 * sonst einmalige Adresse aus den Käuferdaten.
 */
export function invoiceToLexware(inv: InvoiceLike, contactId: string | null): LexwareVoucherPayload {
  const items = parseItems(inv.items);
  if (items.length === 0) throw new Error("Beleg hat keine Positionen.");
  if (!contactId && !inv.buyerName?.trim()) throw new Error("Käufername fehlt (oder Kontakt zuerst an Lexware übertragen).");
  const allZero = items.every((i) => i.vatRate === 0);
  const isQuote = inv.kind === "QUOTE";
  const isOrder = inv.kind === "ORDER";
  const payload: LexwareVoucherPayload = {
    voucherDate: lexDate(inv.issueDate),
    address: contactId ? { contactId } : { name: inv.buyerName!.trim().slice(0, 255), ...parseAddress(inv.buyerAddress) },
    lineItems: items.map((i) => ({
      type: "custom",
      name: i.title.slice(0, 255),
      quantity: i.qty,
      unitName: UNIT_NAMES[i.unit] ?? "Stück",
      unitPrice: { currency: inv.currency || "EUR", netAmount: euro(i.unitCents), taxRatePercentage: i.vatRate },
      discountPercentage: 0,
    })),
    totalPrice: { currency: inv.currency || "EUR" },
    taxConditions: allZero
      ? { taxType: "vatfree", ...(inv.taxExemptionReason ? { taxTypeNote: inv.taxExemptionReason.slice(0, 255) } : {}) }
      : { taxType: "net" },
    title: isQuote ? "Angebot" : isOrder ? "Auftragsbestätigung" : "Rechnung",
    introduction: `Unsere Referenz: ${inv.number}`,
    ...(inv.notes ? { remark: inv.notes.slice(0, 2000) } : {}),
  };
  if (isQuote) {
    const exp = inv.dueDate ?? new Date(inv.issueDate.getTime() + 30 * 864e5);
    payload.expirationDate = lexDate(exp);
  } else {
    if (isOrder) payload.paymentConditions = { paymentTermLabel: "Zahlbar innerhalb von 14 Tagen nach Rechnungsstellung ohne Abzug.", paymentTermDuration: 14 };
    payload.shippingConditions =
      inv.serviceFrom && inv.serviceTo
        ? { shippingType: "serviceperiod", shippingDate: lexDate(inv.serviceFrom), shippingEndDate: lexDate(inv.serviceTo) }
        : { shippingType: "service", shippingDate: lexDate(inv.serviceFrom ?? inv.issueDate) };
  }
  return payload;
}

// ---------- Kontakte ----------

export type CompanyLike = { name: string; phone: string | null; address: string | null; website: string | null };
export type ContactLike = { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; company: string | null };

export type LexwareContactPayload = {
  version: number;
  roles: { customer: Record<string, never> };
  company?: { name: string; contactPersons?: { lastName: string; firstName?: string; emailAddress?: string; phoneNumber?: string; primary?: boolean }[] };
  person?: { lastName: string; firstName?: string };
  addresses?: { billing: ParsedAddress[] };
  emailAddresses?: { business: string[] };
  phoneNumbers?: { business: string[] };
  note?: string;
};

/** Unternehmen (optional mit Hauptansprechpartner) → Lexware-Kunde vom Typ Firma. */
export function companyToLexware(c: CompanyLike, primary: ContactLike | null, version = 0): LexwareContactPayload {
  const person = primary && (primary.lastName || primary.email)
    ? [{
        lastName: (primary.lastName || primary.email!.split("@")[0]).slice(0, 255),
        ...(primary.firstName ? { firstName: primary.firstName.slice(0, 255) } : {}),
        ...(primary.email ? { emailAddress: primary.email } : {}),
        ...(primary.phone ? { phoneNumber: primary.phone } : {}),
        primary: true,
      }]
    : undefined;
  const addr = c.address ? parseAddress(c.address) : null;
  return {
    version,
    roles: { customer: {} },
    company: { name: c.name.slice(0, 255), ...(person ? { contactPersons: person } : {}) },
    ...(addr && (addr.street || addr.city) ? { addresses: { billing: [addr] } } : {}),
    ...(c.phone ? { phoneNumbers: { business: [c.phone] } } : {}),
    ...(c.website ? { note: `Website: ${c.website}`.slice(0, 1000) } : {}),
  };
}

/** Kontakt ohne Unternehmen → Lexware-Kunde vom Typ Person. */
export function personToLexware(p: ContactLike, version = 0): LexwareContactPayload {
  const lastName = (p.lastName || p.email?.split("@")[0] || "").trim();
  if (!lastName) throw new Error("Nachname oder E-Mail fehlt.");
  return {
    version,
    roles: { customer: {} },
    person: { lastName: lastName.slice(0, 255), ...(p.firstName ? { firstName: p.firstName.slice(0, 255) } : {}) },
    ...(p.email ? { emailAddresses: { business: [p.email] } } : {}),
    ...(p.phone ? { phoneNumbers: { business: [p.phone] } } : {}),
  };
}

/** Lexware-Kontakt (aus GET /v1/contacts) → Felder für den Import ins CRM. */
export type LexwareContact = {
  id: string;
  version: number;
  roles?: { customer?: unknown };
  company?: { name?: string; contactPersons?: { firstName?: string; lastName?: string; emailAddress?: string; phoneNumber?: string }[] };
  person?: { firstName?: string; lastName?: string };
  emailAddresses?: Record<string, string[] | undefined>;
  phoneNumbers?: Record<string, string[] | undefined>;
  addresses?: { billing?: ParsedAddress[] };
  archived?: boolean;
};

export function lexwareToLocal(c: LexwareContact) {
  const firstEmail = Object.values(c.emailAddresses ?? {}).flat().find(Boolean) ?? c.company?.contactPersons?.[0]?.emailAddress ?? null;
  const firstPhone = Object.values(c.phoneNumbers ?? {}).flat().find(Boolean) ?? c.company?.contactPersons?.[0]?.phoneNumber ?? null;
  const billing = c.addresses?.billing?.[0];
  const address = billing ? [billing.street, [billing.zip, billing.city].filter(Boolean).join(" ")].filter(Boolean).join("\n") : null;
  if (c.company?.name) {
    const cp = c.company.contactPersons?.[0];
    return {
      kind: "company" as const,
      companyName: c.company.name,
      address,
      phone: firstPhone,
      contact: cp && (cp.lastName || cp.emailAddress) ? { firstName: cp.firstName ?? null, lastName: cp.lastName ?? null, email: (cp.emailAddress ?? firstEmail)?.toLowerCase() ?? null, phone: cp.phoneNumber ?? firstPhone } : null,
    };
  }
  return {
    kind: "person" as const,
    companyName: null,
    address,
    phone: firstPhone,
    contact: { firstName: c.person?.firstName ?? null, lastName: c.person?.lastName ?? null, email: firstEmail?.toLowerCase() ?? null, phone: firstPhone },
  };
}

/** Lexware-Belegstatus → unser Status (nur eindeutige Fälle). */
export function mapVoucherStatus(kind: string, status: string | undefined): "PAID" | "CANCELLED" | "ACCEPTED" | null {
  if (!status) return null;
  if (kind === "INVOICE" && (status === "paid" || status === "paidoff")) return "PAID";
  if (status === "voided") return "CANCELLED";
  if (kind === "QUOTE" && status === "accepted") return "ACCEPTED";
  return null;
}

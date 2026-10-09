import { z } from "zod";

// Rechnungsberechnung in Cent. Positionen werden kaufmännisch gerundet,
// die Umsatzsteuer je Steuersatz auf die Summe der Positionen (wie EN 16931 / XRechnung).

export const VAT_RATES = [19, 7, 0] as const;

export const itemSchema = z.object({
  title: z.string().trim().min(1, "Positionstext fehlt").max(300),
  qty: z.number().positive("Menge muss größer 0 sein").max(1_000_000),
  unitCents: z.number().int().min(-100_000_000).max(100_000_000),
  vatRate: z.union([z.literal(19), z.literal(7), z.literal(0)]),
  unit: z.enum(["C62", "HUR", "DAY", "MON"]).default("C62"),
});
export type InvoiceItem = z.infer<typeof itemSchema>;

export const UNIT_LABEL: Record<InvoiceItem["unit"], string> = { C62: "Stück", HUR: "Std.", DAY: "Tag(e)", MON: "Monat(e)" };

/** Kaufmännische Rundung (halbe Cent weg von 0). */
export function roundHalfAwayFromZero(x: number) {
  const r = Math.round(Math.abs(x) + 1e-9);
  return x < 0 ? -r : r;
}

export function lineNetCents(item: Pick<InvoiceItem, "qty" | "unitCents">) {
  return roundHalfAwayFromZero(item.qty * item.unitCents);
}

export type VatGroup = { rate: number; netCents: number; vatCents: number };

export function computeTotals(items: InvoiceItem[]) {
  const groups = new Map<number, number>();
  let netCents = 0;
  for (const it of items) {
    const n = lineNetCents(it);
    netCents += n;
    groups.set(it.vatRate, (groups.get(it.vatRate) ?? 0) + n);
  }
  const vatGroups: VatGroup[] = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({ rate, netCents: net, vatCents: roundHalfAwayFromZero((net * rate) / 100) }));
  const vatCents = vatGroups.reduce((s, g) => s + g.vatCents, 0);
  return { netCents, vatCents, grossCents: netCents + vatCents, vatGroups };
}

export function parseItems(raw: unknown): InvoiceItem[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.flatMap((x) => {
    const p = itemSchema.safeParse(x);
    return p.success ? [p.data] : [];
  });
}

export function formatCents(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
}

/** Belegarten: Angebot, Auftragsbestätigung, Rechnung. */
export const DOC_KINDS = ["QUOTE", "ORDER", "INVOICE"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const KIND_LABEL: Record<DocKind, string> = { QUOTE: "Angebot", ORDER: "Auftragsbestätigung", INVOICE: "Rechnung" };
export const KIND_PREFIX: Record<DocKind, string> = { QUOTE: "AN", ORDER: "AB", INVOICE: "RE" };
export const isDocKind = (k: unknown): k is DocKind => typeof k === "string" && (DOC_KINDS as readonly string[]).includes(k);

export function invoicePrefix(kind: DocKind, year: number) {
  return `${KIND_PREFIX[kind]}-${year}-`;
}

export function nextNumber(kind: DocKind, year: number, lastNumber: string | null) {
  const prefix = invoicePrefix(kind, year);
  const n = lastNumber?.startsWith(prefix) ? Number(lastNumber.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0")}`;
}

/** Freitext-Adresse grob zerlegen: erste Zeile Straße, Zeile „PLZ Ort“, optional Land (ISO-2). */
export function parseAddress(text: string | null | undefined) {
  const lines = (text ?? "").split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);
  let street = "", zip = "", city = "", country = "DE";
  for (const l of lines) {
    const m = /^(?:([A-Z]{2})-)?(\d{4,5})\s+(.+)$/.exec(l);
    if (m && !zip) {
      zip = m[2];
      city = m[3];
      if (m[1]) country = m[1];
    } else if (/^[A-Z]{2}$/.test(l)) country = l;
    else if (/^(deutschland|germany)$/i.test(l)) country = "DE";
    else if (/^(österreich|austria)$/i.test(l)) country = "AT";
    else if (!street) street = l;
  }
  return { street, zip, city, country };
}

export const STATUS_LABEL: Record<string, string> = { DRAFT: "Entwurf", SENT: "Versendet", ACCEPTED: "Angenommen", PAID: "Bezahlt", CANCELLED: "Storniert" };

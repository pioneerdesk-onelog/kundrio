import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { computeTotals, formatCents, lineNetCents, parseItems, UNIT_LABEL, KIND_LABEL, isDocKind } from "../invoice";

// PDF eines Belegs (Angebot, Auftragsbestätigung, Rechnung) mit pdf-lib (MIT, reines JS, keine Browser-/Chrome-Abhängigkeit,
// läuft im Worker und auf arm64). Layout entspricht der Druckansicht: Branding-Farbe, Absender, Empfänger, Positionen,
// Summen je Steuersatz, Texte, Pflichtangaben im Fuß. Standardschrift Helvetica (WinAnsi: Umlaute und € enthalten).

export type PdfDoc = {
  kind: string;
  number: string;
  status: string;
  issueDate: Date;
  dueDate: Date | null;
  serviceFrom: Date | null;
  serviceTo: Date | null;
  currency: string;
  items: unknown;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerReference: string | null;
  customerOrderRef: string | null;
  taxExemptionReason: string | null;
  notes: string | null;
};
export type PdfSeller = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  domain: string | null;
  vatId: string | null;
  iban: string | null;
  bic: string | null;
  brandPrimary: string;
};
export type PdfTexts = { intro: string; outro: string; paymentTerms: string };

const A4 = { w: 595.28, h: 841.89 };
const M = { l: 50, r: 50, t: 50, b: 60 };

/** Zeichen, die Helvetica (WinAnsi) nicht kennt, ersetzen statt abzustürzen. */
export function winAnsi(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ€ŒœŠšŸŽžƒˆ˜†‡•‰‹›™]/gu, "?");
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0x0b4f6c;
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

const day = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" }).format(d) : "");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text).split(/\r?\n/)) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const cand = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) line = cand;
      else {
        if (line) out.push(line);
        // sehr lange Wörter hart umbrechen
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > maxWidth) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function renderDocumentPdf(doc: PdfDoc, seller: PdfSeller, texts: PdfTexts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const kindLabel = isDocKind(doc.kind) ? KIND_LABEL[doc.kind] : "Beleg";
  pdf.setTitle(`${kindLabel} ${doc.number}`);
  pdf.setAuthor(winAnsi(seller.name));
  pdf.setCreator("Kundrio");
  pdf.setProducer("pdf-lib");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = hexToRgb(seller.brandPrimary);
  const ink = rgb(0.12, 0.16, 0.22);
  const grey = rgb(0.37, 0.42, 0.47);
  const items = parseItems(doc.items);
  const totals = computeTotals(items);
  const money = (c: number) => winAnsi(formatCents(c, doc.currency));

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M.t;
  const width = A4.w - M.l - M.r;

  const text = (s: string, x: number, yy: number, opts: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(winAnsi(s), { x, y: yy, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? ink });
  const right = (s: string, xRight: number, yy: number, opts: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 10;
    text(s, xRight - f.widthOfTextAtSize(winAnsi(s), size), yy, opts);
  };
  const ensure = (needed: number) => {
    if (y - needed < M.b + 20) {
      footer();
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M.t;
    }
  };
  const footer = () => {
    const parts = [seller.name, (seller.address ?? "").split(/\r?\n/).filter(Boolean).join(", "), seller.vatId ? `USt-IdNr. ${seller.vatId}` : "", seller.iban ? `IBAN ${seller.iban}${seller.bic ? ` · BIC ${seller.bic}` : ""}` : ""].filter(Boolean);
    const lines = wrap(parts.join(" · "), font, 7.5, width);
    let fy = M.b - 20;
    page.drawLine({ start: { x: M.l, y: M.b - 8 }, end: { x: A4.w - M.r, y: M.b - 8 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.89) });
    for (const l of lines.slice(0, 3)) {
      text(l, M.l, fy, { size: 7.5, color: grey });
      fy -= 9;
    }
  };

  // Kopf: Firmenname (Markenfarbe) links, Absenderblock rechts
  text(seller.name, M.l, y - 4, { f: bold, size: 18, color: brand });
  let ry = y;
  for (const l of [seller.name, ...(seller.address ?? "").split(/\r?\n/).filter(Boolean), seller.phone ? `Tel. ${seller.phone}` : "", seller.email ?? "", seller.domain ?? ""].filter(Boolean)) {
    right(l, A4.w - M.r, ry, { size: 8.5, color: grey });
    ry -= 11;
  }
  y = Math.min(y - 40, ry - 10);

  // Absenderzeile + Empfänger
  text([seller.name, (seller.address ?? "").split(/\r?\n/).filter(Boolean).join(" · ")].filter(Boolean).join(" · "), M.l, y, { size: 7, color: grey });
  y -= 16;
  const recipient = [doc.buyerName ?? "", ...(doc.buyerAddress ?? "").split(/\r?\n/).filter(Boolean)];
  let ly = y;
  for (const [i, l] of recipient.entries()) {
    text(l, M.l, ly, { f: i === 0 ? bold : font, size: 10 });
    ly -= 13;
  }
  // Metadaten rechts
  const meta: [string, string][] = [[`${kindLabel === "Rechnung" ? "Rechnungsnr." : kindLabel === "Angebot" ? "Angebotsnr." : "AB-Nr."}`, doc.number], ["Datum", day(doc.issueDate)]];
  if (doc.kind === "INVOICE" || doc.kind === "ORDER") {
    meta.push(doc.serviceFrom && doc.serviceTo ? ["Leistungszeitraum", `${day(doc.serviceFrom)} - ${day(doc.serviceTo)}`] : ["Leistungsdatum", day(doc.serviceFrom ?? doc.issueDate)]);
  }
  if (doc.dueDate && doc.kind !== "ORDER") meta.push([doc.kind === "INVOICE" ? "Fällig am" : "Gültig bis", day(doc.dueDate)]);
  if (doc.customerOrderRef) meta.push(["Ihre Bestellung", doc.customerOrderRef]);
  if (doc.buyerReference) meta.push(["Ihre Referenz", doc.buyerReference]);
  let my = y;
  for (const [k, v] of meta) {
    right(v, A4.w - M.r, my, { size: 9 });
    right(k, A4.w - M.r - 120, my, { size: 9, color: grey });
    my -= 12;
  }
  y = Math.min(ly, my) - 24;

  text(`${kindLabel} ${doc.number}`, M.l, y, { f: bold, size: 16, color: brand });
  y -= 14;
  if (doc.status === "CANCELLED") {
    y -= 4;
    text("STORNIERT", M.l, y, { f: bold, size: 11, color: rgb(0.72, 0.11, 0.11) });
    y -= 14;
  }
  y -= 8;

  const para = (s: string, size = 10) => {
    for (const l of wrap(s, font, size, width)) {
      ensure(14);
      text(l, M.l, y, { size });
      y -= size + 4;
    }
  };
  if (texts.intro.trim()) {
    para(texts.intro);
    y -= 8;
  }

  // Positionen
  const col = { pos: M.l, title: M.l + 28, qty: M.l + 300, unit: M.l + 380, vat: M.l + 430, net: A4.w - M.r };
  const header = () => {
    ensure(24);
    text("Pos.", col.pos, y, { f: bold, size: 8.5 });
    text("Leistung", col.title, y, { f: bold, size: 8.5 });
    right("Menge", col.qty + 40, y, { f: bold, size: 8.5 });
    right("Einzelpreis", col.vat - 6, y, { f: bold, size: 8.5 });
    right("USt", col.vat + 28, y, { f: bold, size: 8.5 });
    right("Netto", col.net, y, { f: bold, size: 8.5 });
    y -= 5;
    page.drawLine({ start: { x: M.l, y }, end: { x: A4.w - M.r, y }, thickness: 1.2, color: brand });
    y -= 12;
  };
  header();
  items.forEach((it, i) => {
    const lines = wrap(it.title, font, 9, col.qty - col.title - 50);
    ensure(lines.length * 11 + 6);
    if (y > A4.h - M.t - 5) header();
    text(String(i + 1), col.pos, y, { size: 9 });
    right(`${it.qty.toLocaleString("de-DE")} ${UNIT_LABEL[it.unit]}`, col.qty + 40, y, { size: 9 });
    right(money(it.unitCents), col.vat - 6, y, { size: 9 });
    right(`${it.vatRate} %`, col.vat + 28, y, { size: 9 });
    right(money(lineNetCents(it)), col.net, y, { size: 9 });
    for (const l of lines) {
      text(l, col.title, y, { size: 9 });
      y -= 11;
    }
    y -= 3;
    page.drawLine({ start: { x: M.l, y: y + 6 }, end: { x: A4.w - M.r, y: y + 6 }, thickness: 0.4, color: rgb(0.9, 0.91, 0.92) });
  });

  // Summen
  y -= 6;
  ensure(30 + totals.vatGroups.length * 13);
  const sumRow = (k: string, v: string, b = false) => {
    right(v, A4.w - M.r, y, { f: b ? bold : font, size: b ? 11 : 9.5 });
    right(k, A4.w - M.r - 110, y, { f: b ? bold : font, size: b ? 11 : 9.5 });
    y -= b ? 16 : 13;
  };
  sumRow("Summe netto", money(totals.netCents));
  for (const g of totals.vatGroups) sumRow(`USt ${g.rate} % auf ${money(g.netCents)}`, money(g.vatCents));
  page.drawLine({ start: { x: A4.w - M.r - 220, y: y + 10 }, end: { x: A4.w - M.r, y: y + 10 }, thickness: 1.2, color: brand });
  sumRow("Gesamtbetrag", money(totals.grossCents), true);
  y -= 8;

  if (totals.vatGroups.some((g) => g.rate === 0)) {
    para(doc.taxExemptionReason ? `Positionen mit 0 % USt: ${doc.taxExemptionReason}` : "Hinweis: Für Positionen mit 0 % USt fehlt der Befreiungsgrund.", 8.5);
    y -= 4;
  }
  if (texts.paymentTerms.trim()) {
    para(texts.paymentTerms, 9.5);
    y -= 6;
  }
  if (doc.notes?.trim()) {
    para(doc.notes, 9.5);
    y -= 6;
  }
  if (texts.outro.trim()) para(texts.outro);

  footer();
  return pdf.save();
}

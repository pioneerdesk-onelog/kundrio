import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { winAnsi } from "../documents/pdf";

// SEPA-Lastschriftmandat zum Unterschreiben (Text nach Muster der Deutschen Kreditwirtschaft).

export type MandateDoc = {
  creditorName: string;
  creditorAddress: string | null;
  creditorId: string;
  mandateRef: string;
  scheme: "CORE" | "B1" | string;
  recurring: boolean;
  debtorName: string;
  debtorAddress: string | null;
  ibanMasked: string;
  bic: string | null;
};

export function mandateText(d: MandateDoc): { title: string; paragraphs: string[] } {
  const b2b = d.scheme !== "CORE";
  const title = b2b ? "SEPA-Firmenlastschrift-Mandat" : "SEPA-Lastschriftmandat";
  const p1 = b2b
    ? `Ich ermächtige / Wir ermächtigen ${d.creditorName}, Zahlungen von meinem / unserem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein / weisen wir unser Kreditinstitut an, die von ${d.creditorName} auf mein / unser Konto gezogenen Lastschriften einzulösen.`
    : `Ich ermächtige ${d.creditorName}, Zahlungen von meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut an, die von ${d.creditorName} auf mein Konto gezogenen Lastschriften einzulösen.`;
  const p2 = b2b
    ? "Hinweis: Dieses Lastschriftmandat dient nur dem Einzug von Lastschriften, die auf Konten von Unternehmen gezogen sind. Ich bin / Wir sind nicht berechtigt, nach der erfolgten Einlösung eine Erstattung des belasteten Betrages zu verlangen. Ich bin / Wir sind berechtigt, mein / unser Kreditinstitut bis zum Fälligkeitstag anzuweisen, Lastschriften nicht einzulösen."
    : "Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem Kreditinstitut vereinbarten Bedingungen.";
  return {
    title,
    paragraphs: [
      p1,
      p2,
      `Gläubiger-Identifikationsnummer: ${d.creditorId}`,
      `Mandatsreferenz: ${d.mandateRef} (${d.recurring ? "wiederkehrende Zahlung" : "einmalige Zahlung"})`,
      "Der Zahlungsempfänger kündigt den Einzug spätestens 14 Kalendertage vor Fälligkeit an (Vorabankündigung), sofern nichts anderes vereinbart ist.",
    ],
  };
}

export async function renderMandatePdf(d: MandateDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.08, 0.1);
  let y = 790;
  const line = (t: string, size = 10, f = font) => {
    page.drawText(winAnsi(t), { x: 50, y, size, font: f, color: ink });
    y -= size + 6;
  };
  const para = (t: string) => {
    const words = winAnsi(t).split(/\s+/);
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, 10) > 495) {
        line(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) line(cur);
    y -= 6;
  };
  const t = mandateText(d);
  line(t.title, 16, bold);
  y -= 6;
  line(`Zahlungsempfänger: ${d.creditorName}`, 10, bold);
  if (d.creditorAddress) for (const l of d.creditorAddress.split(/\r?\n/)) line(l);
  y -= 8;
  for (const p of t.paragraphs) para(p);
  y -= 8;
  line("Zahlungspflichtige/r (Kontoinhaber/in)", 11, bold);
  line(`Name: ${d.debtorName}`);
  if (d.debtorAddress) line(`Anschrift: ${d.debtorAddress.replace(/\r?\n/g, ", ")}`);
  line(`IBAN: ${d.ibanMasked}`);
  if (d.bic) line(`BIC: ${d.bic}`);
  y -= 40;
  page.drawLine({ start: { x: 50, y }, end: { x: 260, y }, thickness: 0.7, color: ink });
  page.drawLine({ start: { x: 300, y }, end: { x: 545, y }, thickness: 0.7, color: ink });
  y -= 14;
  page.drawText("Ort, Datum", { x: 50, y, size: 9, font, color: ink });
  page.drawText("Unterschrift Kontoinhaber/in", { x: 300, y, size: 9, font, color: ink });
  return pdf.save();
}

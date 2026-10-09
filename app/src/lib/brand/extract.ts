import { unzipSync, strFromU8 } from "fflate";

// Text aus Brandbook-Dateien ziehen – je Abschnitt mit Quellangabe (Datei + Seite/Folie).
// PDF über unpdf (MIT), DOCX über mammoth (BSD-2), PPTX aus dem Folien-XML. Bilder: kein Text.

export type Section = { source: string; text: string };

const MAX_CHARS_PER_FILE = 200_000;

function decodeXmlText(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/** PPTX: Texte (<a:t>) je Folie in Folienreihenfolge. */
export function pptxSections(name: string, data: Uint8Array): Section[] {
  const files = unzipSync(data, { filter: (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  return Object.keys(files)
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
    .map((f) => {
      const xml = strFromU8(files[f]);
      const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlText(m[1])).join("")).filter(Boolean);
      return { source: `${name} · Folie ${f.match(/(\d+)\.xml$/)![1]}`, text: paras.join("\n") };
    })
    .filter((s) => s.text.trim());
}

export async function pdfSections(name: string, data: Uint8Array): Promise<Section[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text])
    .map((t, i) => ({ source: `${name} · Seite ${i + 1}`, text: String(t) }))
    .filter((s) => s.text.trim());
}

export async function docxSections(name: string, data: Uint8Array): Promise<Section[]> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  // Abschnitte grob nach Leerzeilen-Blöcken, damit Quellen auffindbar bleiben
  const blocks = value.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: Section[] = [];
  let buf = "";
  let n = 1;
  for (const b of blocks) {
    if ((buf + b).length > 3000 && buf) {
      out.push({ source: `${name} · Abschnitt ${n++}`, text: buf });
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + b;
  }
  if (buf) out.push({ source: `${name} · Abschnitt ${n}`, text: buf });
  return out;
}

export async function extractSections(name: string, mime: string, data: Uint8Array): Promise<Section[]> {
  let sections: Section[];
  if (mime === "application/pdf") sections = await pdfSections(name, data);
  else if (mime.includes("wordprocessingml")) sections = await docxSections(name, data);
  else if (mime.includes("presentationml")) sections = pptxSections(name, data);
  else if (mime.startsWith("text/")) sections = [{ source: name, text: new TextDecoder().decode(data) }];
  else if (mime === "image/svg+xml") sections = [{ source: `${name} (SVG)`, text: new TextDecoder().decode(data).slice(0, 20000) }];
  else sections = []; // Raster-Bilder: keine Textauswertung (Bildmodell optional, offener Punkt)
  let total = 0;
  return sections.filter((s) => (total += s.text.length) <= MAX_CHARS_PER_FILE);
}

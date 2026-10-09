// KI-Entwürfe für Landingpages: Prompt-Bausteine und strenge Prüfung der Modellantwort (rein, testbar).
import { z } from "zod";
import { safeHref, type Block, type PageData } from "./p-tree";

const t = (max: number) => z.string().trim().max(max);
const anim = z.enum(["none", "subtle", "expressive"]).catch("subtle");

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Hero"), props: z.object({ eyebrow: t(80).catch(""), heading: t(160).min(3), text: t(600).catch(""), buttonLabel: t(60).catch(""), buttonHref: t(300).catch(""), animation: anim }) }),
  z.object({ type: z.literal("Heading"), props: z.object({ text: t(160).min(2), level: z.enum(["2", "3"]).catch("2"), animation: anim }) }),
  z.object({ type: z.literal("Text"), props: z.object({ markdown: t(4000).min(2), animation: anim }) }),
  z.object({ type: z.literal("Features"), props: z.object({ heading: t(160).catch(""), items: z.array(z.object({ title: t(120).min(1), text: t(600).catch("") })).min(1).max(9), animation: anim }) }),
  z.object({ type: z.literal("FAQ"), props: z.object({ heading: t(160).catch("Häufige Fragen"), items: z.array(z.object({ question: t(300).min(3), answer: t(2000).min(2) })).min(1).max(15), animation: anim }) }),
  z.object({ type: z.literal("CTA"), props: z.object({ heading: t(160).min(2), text: t(600).catch(""), buttonLabel: t(60).catch(""), buttonHref: t(300).catch(""), animation: anim }) }),
  z.object({ type: z.literal("LinkButton"), props: z.object({ label: t(60).min(1), href: t(300), animation: anim }) }),
  z.object({ type: z.literal("Form"), props: z.object({ heading: t(160).catch("Kontakt aufnehmen"), formId: z.string().max(60), animation: anim }) }),
  z.object({ type: z.literal("Booking"), props: z.object({ heading: t(160).catch("Termin buchen"), text: t(600).catch(""), bookingPath: t(200), mode: z.enum(["button", "embed"]).catch("button"), buttonLabel: t(60).catch("Freie Termine ansehen"), animation: anim }) }),
  z.object({ type: z.literal("Spacer"), props: z.object({ size: z.enum(["s", "m", "l"]).catch("m") }) }),
]);

const draftSchema = z.object({
  seoTitle: t(70).catch(""),
  seoDescription: t(170).catch(""),
  blocks: z.array(z.unknown()).min(2).max(25),
});

export const DRAFT_SPEC = `Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Erklärung, ohne Markdown-Codeblock:
{"seoTitle": string (max 70), "seoDescription": string (max 170), "blocks": Block[]}
Erlaubte Blöcke (genau diese Feldnamen):
- {"type":"Hero","props":{"eyebrow":string,"heading":string,"text":string,"buttonLabel":string,"buttonHref":string,"animation":"subtle"}}  ← genau EINMAL, als erster Block
- {"type":"Heading","props":{"text":string,"level":"2"|"3"}}
- {"type":"Text","props":{"markdown":string}}  ← Markdown ohne HTML, keine # H1
- {"type":"Features","props":{"heading":string,"items":[{"title":string,"text":string}]}}
- {"type":"FAQ","props":{"heading":string,"items":[{"question":string,"answer":string}]}}
- {"type":"CTA","props":{"heading":string,"text":string,"buttonLabel":string,"buttonHref":string}}
- {"type":"LinkButton","props":{"label":string,"href":string}}
- {"type":"Form","props":{"heading":string,"formId":string}}  ← nur mit einer der erlaubten Formular-IDs
- {"type":"Booking","props":{"heading":string,"text":string,"bookingPath":string,"mode":"button"|"embed","buttonLabel":string}}  ← „Termin buchen“, nur mit einer der erlaubten Buchungsseiten
- {"type":"Spacer","props":{"size":"s"|"m"|"l"}}
Feld "animation" ist optional: "none" | "subtle" | "expressive".
Buttons verweisen auf "#kontakt" (Formular) oder eine echte https-Adresse aus den Quellen.`;

/** Erstes JSON-Objekt aus einer Modellantwort lösen (Modelle umrahmen gern mit Text oder ```json). */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Die KI-Antwort enthält kein JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export type DraftResult = { seoTitle: string; seoDescription: string; data: PageData; dropped: number };

/** Prüft und normalisiert die KI-Antwort. Ungültige Blöcke werden verworfen, Struktur wird erzwungen. */
export function parseDraft(raw: string, opts: { title: string; formIds: string[]; bookingPaths?: string[] }): DraftResult {
  const top = draftSchema.safeParse(extractJson(raw));
  if (!top.success) throw new Error(`KI-Antwort hat nicht das erwartete Format: ${top.error.issues[0]?.message ?? ""}`);

  let dropped = 0;
  const blocks: Block[] = [];
  for (const b of top.data.blocks) {
    const r = blockSchema.safeParse(b);
    if (!r.success) {
      dropped++;
      continue;
    }
    const block = r.data as Block;
    const p = block.props as Record<string, unknown>;
    if (block.type === "Form" && !opts.formIds.includes(String(p.formId))) {
      dropped++;
      continue;
    }
    // Buchungsblock nur mit einer existierenden, freigeschalteten Buchungsseite
    if (block.type === "Booking" && !(opts.bookingPaths ?? []).includes(String(p.bookingPath))) {
      dropped++;
      continue;
    }
    if (block.type === "Booking" && !String(p.buttonLabel).trim()) p.buttonLabel = "Freie Termine ansehen";
    // Linkziele absichern
    for (const k of ["buttonHref", "href"]) {
      if (k in p && p[k] && !safeHref(p[k])) p[k] = opts.formIds.length ? "#kontakt" : "";
    }
    if (block.type === "LinkButton") Object.assign(p, { variant: "primary", align: "left" });
    if (block.type === "Hero") Object.assign(p, { secondaryLabel: "", secondaryHref: "", align: "left", showLogo: "yes" });
    // Nur ein Hero (H1) erlaubt
    if (block.type === "Hero" && blocks.some((x) => x.type === "Hero")) {
      blocks.push({ type: "Heading", props: { text: String(p.heading), level: "2", animation: "subtle" } });
      continue;
    }
    if (block.type === "Text") p.markdown = String(p.markdown).replace(/^#\s+/gm, "## ");
    blocks.push(block);
  }

  if (!blocks.some((b) => b.type === "Hero")) {
    blocks.unshift({ type: "Hero", props: { eyebrow: "", heading: opts.title, text: "", buttonLabel: "", buttonHref: "", secondaryLabel: "", secondaryHref: "", align: "left", showLogo: "yes", animation: "subtle" } });
  } else if (blocks[0].type !== "Hero") {
    const i = blocks.findIndex((b) => b.type === "Hero");
    blocks.unshift(...blocks.splice(i, 1));
  }
  if (blocks.length < 2) throw new Error("Die KI hat zu wenig verwertbaren Inhalt geliefert.");

  const content = [...blocks, { type: "Footer", props: { note: "" } }].map((b) => ({
    type: b.type,
    props: { ...b.props, id: `${b.type}-${crypto.randomUUID()}` },
  }));
  return {
    seoTitle: top.data.seoTitle,
    seoDescription: top.data.seoDescription,
    data: { root: { props: { title: opts.title } }, content },
    dropped,
  };
}

/** Prüft die Übersetzungsantwort: JSON-Array mit gleicher Länge, nur Strings. */
export function parseTranslation(raw: string, expected: number): string[] {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Übersetzung enthält kein JSON-Array.");
  const arr = z.array(z.string()).safeParse(JSON.parse(cleaned.slice(start, end + 1)));
  if (!arr.success) throw new Error("Übersetzung: Array enthält Nicht-Text-Werte.");
  if (arr.data.length !== expected) throw new Error(`Übersetzung unvollständig: ${arr.data.length} statt ${expected} Texte.`);
  return arr.data;
}

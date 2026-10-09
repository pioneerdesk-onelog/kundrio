import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { aiChat } from "@/lib/ai";
import type { JobHandler } from "@/lib/jobs";
import { search } from "@/lib/rag";
import { DRAFT_SPEC, parseDraft, parseTranslation } from "@/lib/p-draft";
import { LANG_NAMES } from "@/lib/p-meta";
import { applyTexts, collectTexts, type PageData } from "@/lib/p-tree";
import { brandVoicePrompt } from "@/lib/brand/voice";

async function loadPage(p: Record<string, unknown>) {
  const page = await db.landingPage.findFirst({ where: { id: String(p.pageId), workspaceId: String(p.workspaceId) } });
  if (!page) throw new Error("Seite existiert nicht mehr");
  return page;
}

/** KI-Entwurf: nur Fakten aus Wiki + Wissensbasis des eigenen Sub-Accounts. */
const draft: JobHandler = async (p) => {
  const page = await loadPage(p);
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: page.workspaceId } });
  const brief = String(p.brief ?? "").slice(0, 4000);

  const [start, forms] = await Promise.all([
    db.wikiPage.findUnique({ where: { workspaceId_slug: { workspaceId: ws.id, slug: "start" } } }),
    db.form.findMany({ where: { workspaceId: ws.id }, select: { id: true, name: true } }),
  ]);
  const bookings = await db.meetingType.findMany({ where: { workspaceId: ws.id, active: true, bookingEnabled: true, bookingSlug: { not: null } }, select: { name: true, bookingSlug: true } });
  const bookingPaths = bookings.map((b) => `/buchen/${ws.slug}/${b.bookingSlug}`);
  let hits: { title: string; content: string }[] = [];
  try {
    hits = await search(ws.id, brief, 6);
  } catch {
    hits = []; // ohne Wissensbasis weiter; das Modell soll dann Lücken markieren
  }
  const sources = [
    start ? `[Wiki: ${start.title}]\n${start.body.slice(0, 3000)}` : "",
    ...hits.map((h, i) => `[Quelle ${i + 1}: ${h.title}]\n${h.content}`),
  ].filter(Boolean).join("\n\n---\n\n");

  const language = LANG_NAMES[page.lang] ?? page.lang;
  const voice = await brandVoicePrompt(ws.id);
  const raw = await aiChat(ws.id, "page-draft", [
    ...(voice ? [{ role: "system" as const, content: voice }] : []),
    {
      role: "system",
      content:
        `Du schreibst Landingpages für „${ws.name}“${ws.domain ? ` (${ws.domain})` : ""} auf ${language}. ` +
        "Stil: klar, sachlich, jargonarm, keine Übertreibungen. " +
        "Nutze NUR Fakten aus den Quellen. Erfinde keine Preise, Zahlen, Kundennamen, Zitate, Testimonials, Auszeichnungen oder Termine. " +
        "Wo ein Fakt fehlt, schreibe „[bitte ergänzen]“.\n\n" +
        DRAFT_SPEC +
        `\nErlaubte Formular-IDs: ${forms.length ? forms.map((f) => `${f.id} (${f.name})`).join(", ") : "keine – keinen Form-Block verwenden"}` +
        `\nErlaubte Buchungsseiten: ${bookings.length ? bookings.map((b, i) => `${bookingPaths[i]} (${b.name})`).join(", ") : "keine – keinen Booking-Block verwenden"}`,
    },
    { role: "user", content: `Seitentitel: ${page.title}\n\nBriefing:\n${brief}\n\nQuellen:\n${sources || "(keine Quellen vorhanden)"}` },
  ], { temperature: 0.4 });

  const result = parseDraft(raw, { title: page.title, formIds: forms.map((f) => f.id), bookingPaths });
  await db.landingPage.update({
    where: { id: page.id },
    data: {
      data: result.data as Prisma.InputJsonValue,
      seoTitle: result.seoTitle || null,
      seoDescription: result.seoDescription || null,
      aiGenerated: true,
    },
  });
};

/** Übersetzt nur Text-Props; Links, IDs und Auswahlwerte bleiben unverändert. */
const translate: JobHandler = async (p) => {
  const page = await loadPage(p);
  const data = page.data as PageData;
  const items = collectTexts(data);
  const meta = [page.title, page.seoTitle ?? "", page.seoDescription ?? ""];
  const all = [...meta, ...items.map((i) => i.value)];
  const from = LANG_NAMES[String(p.sourceLang)] ?? String(p.sourceLang);
  const to = LANG_NAMES[String(p.targetLang)] ?? String(p.targetLang);
  const voice = await brandVoicePrompt(page.workspaceId);

  // In Paketen übersetzen, damit das Modell den Überblick behält
  const out: string[] = [];
  let batch: string[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const raw = await aiChat(page.workspaceId, "page-translate", [
      ...(voice ? [{ role: "system" as const, content: `${voice}\nBehalte Anrede und Ton gemäß diesen Vorgaben in der Zielsprache bei.` }] : []),
      {
        role: "system",
        content:
          `Übersetze jeden Text im JSON-Array von ${from} nach ${to}. Behalte Markdown, Zeilenumbrüche, URLs, E-Mail-Adressen, ` +
          "Produkt- und Firmennamen sowie Platzhalter wie [bitte ergänzen] bei. Leere Texte bleiben leer. " +
          "Antworte NUR mit einem JSON-Array von Strings in derselben Reihenfolge und Länge.",
      },
      { role: "user", content: JSON.stringify(batch) },
    ], { temperature: 0.1 });
    out.push(...parseTranslation(raw, batch.length));
    batch = [];
  };
  let size = 0;
  for (const s of all) {
    if (batch.length >= 40 || size + s.length > 6000) {
      await flush();
      size = 0;
    }
    batch.push(s);
    size += s.length;
  }
  await flush();

  const [title, seoTitle, seoDescription, ...texts] = out;
  const translated = applyTexts(data, items, texts);
  if (translated.root?.props) translated.root.props.title = title;
  await db.landingPage.update({
    where: { id: page.id },
    data: {
      data: translated as Prisma.InputJsonValue,
      title: title.trim() || page.title,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      aiGenerated: true,
    },
  });
};

export const handlers: Record<string, JobHandler> = {
  "page.draft": draft,
  "page.translate": translate,
};

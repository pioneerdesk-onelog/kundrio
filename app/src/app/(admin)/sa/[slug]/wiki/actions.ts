"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/permissions/guard";
import { indexSource, search } from "@/lib/rag";
import { aiChat } from "@/lib/ai";
import { env } from "@/lib/env";
import { slugify } from "@/lib/c-diff";
import { brandVoicePrompt } from "@/lib/brand/voice";

export type FormState = { ok?: string; error?: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function ownPage(slug: string, pageSlug: string, action: "edit" | "delete" | "read" = "edit") {
  const { ws } = await guard(slug, { object: "knowledge", action });
  const page = await db.wikiPage.findUnique({ where: { workspaceId_slug: { workspaceId: ws.id, slug: pageSlug } } });
  if (!page) throw new Error("Wiki-Seite nicht gefunden");
  return { ws, page };
}

const NewPage = z.object({ title: z.string().trim().min(1, "Titel fehlt").max(200) });

export async function createPage(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { ws } = await guard(slug, { object: "knowledge", action: "edit" });
  const p = NewPage.safeParse({ title: fd.get("title") });
  if (!p.success) return { error: p.error.issues[0].message };
  const base = slugify(p.data.title);
  let pageSlug = base;
  for (let i = 2; await db.wikiPage.findUnique({ where: { workspaceId_slug: { workspaceId: ws.id, slug: pageSlug } } }); i++) {
    pageSlug = `${base}-${i}`;
  }
  const body = `# ${p.data.title}\n\n`;
  await db.wikiPage.create({
    data: {
      workspaceId: ws.id,
      slug: pageSlug,
      title: p.data.title,
      body,
      revisions: { create: { body, author: "mensch", note: "Seite angelegt" } },
    },
  });
  revalidatePath(`/sa/${slug}/wiki`);
  redirect(`/sa/${slug}/wiki/${pageSlug}?edit=1`);
}

const Save = z.object({
  title: z.string().trim().min(1, "Titel fehlt").max(200),
  body: z.string().max(500_000, "Seite ist zu lang"),
  note: z.string().trim().max(300).optional(),
});

export async function savePage(slug: string, pageSlug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const p = Save.safeParse({ title: fd.get("title"), body: fd.get("body"), note: fd.get("note") || undefined });
  if (!p.success) return { error: p.error.issues[0].message };
  const { page } = await ownPage(slug, pageSlug);
  await db.$transaction([
    db.wikiPage.update({ where: { id: page.id }, data: { title: p.data.title, body: p.data.body } }),
    db.wikiRevision.create({ data: { pageId: page.id, body: p.data.body, author: "mensch", status: "applied", note: p.data.note } }),
  ]);
  revalidatePath(`/sa/${slug}/wiki/${pageSlug}`);
  redirect(`/sa/${slug}/wiki/${pageSlug}`);
}

const SYSTEM = `Du pflegst ein Wiki für ein Unternehmensprojekt (Prinzip „LLM-Wiki“).
Aufgabe: Überarbeite die Wiki-Seite mit den neuen Informationen aus den Quellen.
Regeln:
- Behalte Struktur, Überschriften und bestehende korrekte Aussagen bei.
- Ergänze nur, was die Quellen belegen. Markiere Herkunft knapp mit (Quelle: <Titel>).
- Widersprüche zwischen Seite und Quelle nicht still auflösen, sondern als „> Widerspruch: …“ kennzeichnen.
- Nichts erfinden. Keine Secrets, keine personenbezogenen Daten übernehmen.
- Deutsch, klar, knapp.
- Gib NUR den vollständigen neuen Markdown-Text der Seite aus, ohne Vorbemerkung und ohne Codeblock-Zäune.`;

export async function proposeLlm(slug: string, pageSlug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, page } = await ownPage(slug, pageSlug);
    const focus = z.string().trim().max(500).optional().parse(fd.get("focus") || undefined);
    const hits = await search(ws.id, `${page.title}\n${focus ?? ""}\n${page.body.slice(0, 1500)}`, 8);
    // Die eigene Wiki-Quelle nicht als „neue“ Information verwenden
    const own = await db.knowledgeSource.findFirst({ where: { workspaceId: ws.id, kind: "wiki", uri: `wiki:${page.slug}` } });
    const relevant = hits.filter((h) => h.sourceId !== own?.id);
    if (relevant.length === 0) return { error: "Keine passenden Quellen in der Wissensbasis gefunden. Erst Wissen hinzufügen." };
    const context = relevant.map((h, i) => `[${i + 1}] (${h.title})\n${h.content}`).join("\n\n---\n\n");
    const voice = await brandVoicePrompt(ws.id);
    let out = await aiChat(ws.id, "wiki-proposal", 
      [
        { role: "system", content: SYSTEM },
        ...(voice ? [{ role: "system" as const, content: voice }] : []),
        {
          role: "user",
          content: `Aktuelle Seite „${page.title}“:\n\n${page.body}\n\n====\nQuellen:\n\n${context}${focus ? `\n\n====\nSchwerpunkt: ${focus}` : ""}`,
        },
      ],
      { temperature: 0.2 },
    );
    out = out.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1").trim();
    if (!out) return { error: "Das Modell hat keinen Text geliefert." };
    await db.wikiRevision.create({
      data: {
        pageId: page.id,
        body: out,
        author: `llm:${env.chatModel()}`,
        status: "proposed",
        note: `${relevant.length} Quellen${focus ? ` · Schwerpunkt: ${focus}` : ""}`,
      },
    });
    revalidatePath(`/sa/${slug}/wiki/${pageSlug}`);
    return { ok: "Vorschlag erstellt. Bitte prüfen und übernehmen oder verwerfen." };
  } catch (e) {
    return { error: `Vorschlag fehlgeschlagen: ${msg(e)}` };
  }
}

async function ownProposal(slug: string, pageSlug: string, revisionId: string) {
  const { ws, page } = await ownPage(slug, pageSlug);
  const rev = await db.wikiRevision.findFirst({ where: { id: revisionId, pageId: page.id, status: "proposed" } });
  if (!rev) throw new Error("Vorschlag nicht gefunden oder bereits bearbeitet");
  return { ws, page, rev };
}

export async function applyProposal(slug: string, pageSlug: string, revisionId: string) {
  const { page, rev } = await ownProposal(slug, pageSlug, revisionId);
  await db.$transaction([
    db.wikiPage.update({ where: { id: page.id }, data: { body: rev.body } }),
    db.wikiRevision.update({ where: { id: rev.id }, data: { status: "applied", note: `${rev.note ?? ""} · vom Menschen übernommen`.trim() } }),
  ]);
  revalidatePath(`/sa/${slug}/wiki/${pageSlug}`);
}

export async function rejectProposal(slug: string, pageSlug: string, revisionId: string) {
  const { rev } = await ownProposal(slug, pageSlug, revisionId);
  await db.wikiRevision.update({ where: { id: rev.id }, data: { status: "rejected" } });
  revalidatePath(`/sa/${slug}/wiki/${pageSlug}`);
}

export async function indexWikiPage(slug: string, pageSlug: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws, page } = await ownPage(slug, pageSlug);
    const uri = `wiki:${page.slug}`;
    const existing = await db.knowledgeSource.findFirst({ where: { workspaceId: ws.id, kind: "wiki", uri } });
    const src = existing
      ? await db.knowledgeSource.update({ where: { id: existing.id }, data: { title: `Wiki: ${page.title}`, status: "pending", isPublic: true } })
      : await db.knowledgeSource.create({ data: { workspaceId: ws.id, kind: "wiki", uri, title: `Wiki: ${page.title}`, isPublic: true } });
    const r = await indexSource(src.id, `# ${page.title}\n\n${page.body}`);
    revalidatePath(`/sa/${slug}/wissen`);
    return { ok: `Ins Wissen übernommen (${r.chunks} Abschnitte).` };
  } catch (e) {
    return { error: `Indizierung fehlgeschlagen: ${msg(e)}` };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/permissions/guard";
import { answer, indexSource, type Hit } from "@/lib/rag";
import { safeFetchText } from "@/lib/c-fetch";

export type FormState = { ok?: string; error?: string };
export type AskState = { question?: string; answer?: string; hits?: Hit[]; error?: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TextSchema = z.object({
  title: z.string().trim().min(1, "Titel fehlt").max(200),
  content: z.string().trim().min(1, "Inhalt fehlt").max(500_000, "Text ist zu lang (max. 500.000 Zeichen)"),
});

export async function addTextSource(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { ws } = await guard(slug, { object: "knowledge", action: "edit" });
  const parsed = TextSchema.safeParse({ title: fd.get("title"), content: fd.get("content") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const src = await db.knowledgeSource.create({
    data: { workspaceId: ws.id, kind: "text", title: parsed.data.title, content: parsed.data.content, isPublic: fd.get("isPublic") === "on" },
  });
  try {
    const r = await indexSource(src.id, parsed.data.content);
    return { ok: `„${src.title}“ indiziert (${r.chunks} Abschnitte).` };
  } catch (e) {
    return { error: `Indizierung fehlgeschlagen: ${msg(e)}` };
  } finally {
    revalidatePath(`/sa/${slug}/wissen`);
  }
}

const UrlSchema = z.object({
  url: z.url({ protocol: /^https?$/, error: "Bitte eine gültige http(s)-URL angeben" }),
  title: z.string().trim().max(200).optional(),
});

async function fetchAndIndex(sourceId: string, url: string) {
  try {
    const page = await safeFetchText(url);
    if (!page.text.trim()) throw new Error("Seite enthält keinen lesbaren Text");
    return { page, result: await indexSource(sourceId, page.text) };
  } catch (e) {
    // indexSource setzt den Status selbst; Abruffehler hier ebenfalls festhalten
    await db.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "failed", error: msg(e).slice(0, 500) },
    });
    throw e;
  }
}

export async function addUrlSource(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const { ws } = await guard(slug, { object: "knowledge", action: "edit" });
  const parsed = UrlSchema.safeParse({ url: fd.get("url"), title: fd.get("title") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const src = await db.knowledgeSource.create({
    data: { workspaceId: ws.id, kind: "url", title: parsed.data.title || parsed.data.url, uri: parsed.data.url, isPublic: fd.get("isPublic") === "on" },
  });
  try {
    const { page, result } = await fetchAndIndex(src.id, parsed.data.url);
    if (!parsed.data.title && page.title) {
      await db.knowledgeSource.update({ where: { id: src.id }, data: { title: page.title.slice(0, 200) } });
    }
    return { ok: `URL indiziert (${result.chunks} Abschnitte).` };
  } catch (e) {
    return { error: `Abruf/Indizierung fehlgeschlagen: ${msg(e)}` };
  } finally {
    revalidatePath(`/sa/${slug}/wissen`);
  }
}

async function ownSource(slug: string, id: string, action: "edit" | "delete" | "read" = "edit") {
  const { ws } = await guard(slug, { object: "knowledge", action });
  const src = await db.knowledgeSource.findFirst({ where: { id, workspaceId: ws.id } });
  if (!src) throw new Error("Quelle nicht gefunden");
  return { ws, src };
}

export async function reindexSource(slug: string, id: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws, src } = await ownSource(slug, id);
    if (src.kind === "url" && src.uri) {
      const { result } = await fetchAndIndex(src.id, src.uri);
      return { ok: `Neu indiziert (${result.chunks} Abschnitte).` };
    }
    if (src.kind === "wiki" && src.uri?.startsWith("wiki:")) {
      const page = await db.wikiPage.findFirst({ where: { workspaceId: ws.id, slug: src.uri.slice(5) } });
      if (!page) throw new Error("Wiki-Seite existiert nicht mehr");
      const r = await indexSource(src.id, `# ${page.title}\n\n${page.body}`);
      return { ok: `Neu indiziert (${r.chunks} Abschnitte).` };
    }
    if (src.kind === "text" && src.content) {
      const r = await indexSource(src.id, src.content);
      return { ok: `${r.chunks} Abschnitte neu indiziert.` };
    }
    return { error: "Für diese Quelle ist kein Originaltext gespeichert. Bitte neu anlegen." };
  } catch (e) {
    return { error: msg(e) };
  } finally {
    revalidatePath(`/sa/${slug}/wissen`);
  }
}

/** Schaltet um, ob die Quelle über die öffentliche Agent-Schnittstelle zitiert werden darf. */
export async function setSourcePublic(slug: string, id: string, isPublic: boolean) {
  const { src } = await ownSource(slug, id);
  await db.knowledgeSource.update({ where: { id: src.id }, data: { isPublic } });
  revalidatePath(`/sa/${slug}/wissen`);
}

export async function deleteSource(slug: string, id: string) {
  const { src } = await ownSource(slug, id, "delete");
  await db.knowledgeSource.delete({ where: { id: src.id } });
  revalidatePath(`/sa/${slug}/wissen`);
}

export async function ask(slug: string, _prev: AskState, fd: FormData): Promise<AskState> {
  const { ws } = await guard(slug, { object: "knowledge", action: "read" });
  const q = z.string().trim().min(2, "Bitte eine Frage eingeben").max(2000).safeParse(fd.get("question"));
  if (!q.success) return { error: q.error.issues[0].message };
  try {
    const r = await answer(ws.id, q.data);
    return { question: q.data, answer: r.answer, hits: r.hits.map((h) => ({ ...h, score: Number(h.score) })) };
  } catch (e) {
    return { question: q.data, error: `Antwort fehlgeschlagen: ${msg(e)}` };
  }
}

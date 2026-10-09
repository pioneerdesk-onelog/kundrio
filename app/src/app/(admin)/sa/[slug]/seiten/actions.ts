"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { guard } from "@/lib/permissions/guard";
import { checkPage } from "@/lib/p-a11y";
import { loadForms, LANG_RE, SLUG_RE, slugify, starterData } from "@/lib/p-meta";
import type { PageData } from "@/lib/p-tree";

export type ActionState = { error?: string; ok?: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function ownPage(slug: string, id: string, action: "edit" | "delete" | "read" = "edit") {
  const { ws } = await guard(slug, { object: "pages", action });
  const page = await db.landingPage.findFirst({ where: { id, workspaceId: ws.id } });
  if (!page) throw new Error("Seite nicht gefunden");
  return { ws, page };
}

function langsOf(ws: { languages: string[] }) {
  return ws.languages.length ? ws.languages : ["de"];
}

const createSchema = z.object({
  title: z.string().trim().min(2, "Titel zu kurz").max(160),
  slug: z.string().trim().max(80).optional(),
  lang: z.string().regex(LANG_RE, "Ungültige Sprache"),
});

export async function createPage(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ws } = await guard(slug, { object: "pages", action: "edit" });
  const p = createSchema.safeParse({ title: fd.get("title"), slug: fd.get("slug") || undefined, lang: fd.get("lang") || "de" });
  if (!p.success) return { error: p.error.issues[0].message };
  const pageSlug = p.data.slug ? p.data.slug.toLowerCase() : slugify(p.data.title);
  if (!SLUG_RE.test(pageSlug)) return { error: "Adresse (Slug): nur a–z, 0–9 und Bindestriche." };
  if (!langsOf(ws).includes(p.data.lang)) return { error: "Sprache ist für diesen Sub-Account nicht freigeschaltet (Einstellungen)." };
  const exists = await db.landingPage.findFirst({ where: { workspaceId: ws.id, slug: pageSlug, lang: p.data.lang } });
  if (exists) return { error: `Die Adresse „${pageSlug}“ gibt es in dieser Sprache schon.` };
  const page = await db.landingPage.create({
    data: { workspaceId: ws.id, slug: pageSlug, lang: p.data.lang, title: p.data.title, data: starterData(p.data.title) },
  });
  redirect(`/sa/${slug}/seiten/${page.id}/editor`);
}

const draftSchema = z.object({
  title: z.string().trim().min(2).max(160),
  brief: z.string().trim().min(20, "Bitte beschreiben Sie Ziel, Zielgruppe und Angebot (mind. 20 Zeichen).").max(4000),
  lang: z.string().regex(LANG_RE),
});

/** KI-Entwurf: Seite sofort anlegen (Platzhalter), Inhalt erzeugt der Worker. */
export async function createAiDraft(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ws } = await guard(slug, { object: "pages", action: "edit" });
  const p = draftSchema.safeParse({ title: fd.get("title"), brief: fd.get("brief"), lang: fd.get("lang") || "de" });
  if (!p.success) return { error: p.error.issues[0].message };
  if (!langsOf(ws).includes(p.data.lang)) return { error: "Sprache ist nicht freigeschaltet." };
  let pageSlug = slugify(p.data.title);
  for (let i = 2; await db.landingPage.findFirst({ where: { workspaceId: ws.id, slug: pageSlug, lang: p.data.lang } }); i++) {
    pageSlug = `${slugify(p.data.title).slice(0, 74)}-${i}`;
  }
  const page = await db.landingPage.create({
    data: { workspaceId: ws.id, slug: pageSlug, lang: p.data.lang, title: p.data.title, data: starterData(p.data.title), aiGenerated: true },
  });
  await enqueue("page.draft", { workspaceId: ws.id, pageId: page.id, brief: p.data.brief });
  revalidatePath(`/sa/${slug}/seiten`);
  return { ok: "KI-Entwurf wird erstellt. Der Status erscheint in der Liste." };
}

/** Sprachfassung: Kopie in Zielsprache anlegen, Übersetzung macht der Worker. */
export async function createTranslation(slug: string, id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { ws, page } = await ownPage(slug, id);
    const lang = String(fd.get("lang") ?? "");
    if (!LANG_RE.test(lang) || !langsOf(ws).includes(lang)) return { error: "Zielsprache ist nicht freigeschaltet." };
    if (lang === page.lang) return { error: "Das ist bereits die Sprache dieser Seite." };
    const exists = await db.landingPage.findFirst({ where: { workspaceId: ws.id, groupId: page.groupId, lang } });
    if (exists) return { error: "Diese Sprachfassung gibt es schon." };
    const clash = await db.landingPage.findFirst({ where: { workspaceId: ws.id, slug: page.slug, lang } });
    const target = await db.landingPage.create({
      data: {
        workspaceId: ws.id, groupId: page.groupId, lang, slug: clash ? `${page.slug.slice(0, 76)}-${lang}` : page.slug,
        title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription,
        data: page.data as Prisma.InputJsonValue, aiGenerated: true,
      },
    });
    await enqueue("page.translate", { workspaceId: ws.id, pageId: target.id, sourceLang: page.lang, targetLang: lang });
    revalidatePath(`/sa/${slug}/seiten`);
    return { ok: "Übersetzung gestartet. Die neue Fassung bleibt ein Entwurf, bis Sie sie veröffentlichen." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Speichern aus dem Editor (nur Entwurf). */
export async function saveDraft(slug: string, id: string, data: unknown): Promise<ActionState> {
  try {
    const { ws } = await ownPage(slug, id);
    const parsed = z.object({ root: z.record(z.string(), z.unknown()).optional(), content: z.array(z.unknown()), zones: z.record(z.string(), z.unknown()).optional() }).safeParse(data);
    if (!parsed.success) return { error: "Ungültige Seitendaten." };
    if (JSON.stringify(data).length > 1_000_000) return { error: "Seite ist zu groß (max. 1 MB)." };
    await db.landingPage.updateMany({ where: { id, workspaceId: ws.id }, data: { data: parsed.data as Prisma.InputJsonValue } });
    revalidatePath(`/sa/${slug}/seiten/${id}`);
    return { ok: `Gespeichert um ${new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" })}` };
  } catch (e) {
    return { error: msg(e) };
  }
}

const seoSchema = z.object({
  title: z.string().trim().min(2).max(160),
  seoTitle: z.string().trim().max(70, "SEO-Titel: max. 70 Zeichen").optional(),
  seoDescription: z.string().trim().max(170, "Beschreibung: max. 170 Zeichen").optional(),
  slug: z.string().trim().regex(SLUG_RE, "Adresse: nur a–z, 0–9 und Bindestriche"),
});

export async function updateSeo(slug: string, id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { ws, page } = await ownPage(slug, id);
    const p = seoSchema.safeParse({
      title: fd.get("title"), seoTitle: fd.get("seoTitle") || undefined, seoDescription: fd.get("seoDescription") || undefined, slug: String(fd.get("slug") ?? "").toLowerCase(),
    });
    if (!p.success) return { error: p.error.issues[0].message };
    if (p.data.slug !== page.slug) {
      const clash = await db.landingPage.findFirst({ where: { workspaceId: ws.id, slug: p.data.slug, lang: page.lang, NOT: { id } } });
      if (clash) return { error: "Diese Adresse ist schon vergeben." };
    }
    await db.landingPage.updateMany({
      where: { id, workspaceId: ws.id },
      data: { title: p.data.title, seoTitle: p.data.seoTitle ?? null, seoDescription: p.data.seoDescription ?? null, slug: p.data.slug },
    });
    revalidatePath(`/sa/${slug}/seiten/${id}`);
    return { ok: "Gespeichert." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Prüft Barrierefreiheit; nur ohne Fehler wird veröffentlicht. */
export async function publishPage(slug: string, id: string, _prev: ActionState): Promise<ActionState> {
  try {
    const { ws, page } = await ownPage(slug, id);
    const user = await requireUser();
    const forms = await loadForms(ws.id);
    const bookings = await db.meetingType.findMany({ where: { workspaceId: ws.id, active: true, bookingEnabled: true, bookingSlug: { not: null } }, select: { bookingSlug: true } });
    const report = checkPage(page.data as PageData, {
      brandPrimary: ws.brandPrimary,
      brandAccent: ws.brandAccent,
      forms: Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, { fieldCount: v.fields.length }])),
      bookingPaths: bookings.map((b) => `/buchen/${ws.slug}/${b.bookingSlug}`),
    });
    if (!report.ok) {
      await db.landingPage.updateMany({ where: { id, workspaceId: ws.id }, data: { a11yReport: report as unknown as Prisma.InputJsonValue } });
      revalidatePath(`/sa/${slug}/seiten/${id}`);
      return { error: `Nicht veröffentlicht: ${report.errors} Barrierefreiheits-Fehler. Details unten.` };
    }
    await db.landingPage.updateMany({
      where: { id, workspaceId: ws.id },
      data: {
        a11yReport: report as unknown as Prisma.InputJsonValue,
        publishedData: page.data as Prisma.InputJsonValue,
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedBy: user.name,
      },
    });
    revalidatePath(`/sa/${slug}/seiten`);
    revalidatePath(`/sa/${slug}/seiten/${id}`);
    return { ok: report.warnings ? `Veröffentlicht (mit ${report.warnings} Hinweis(en)).` : "Veröffentlicht." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function unpublishPage(slug: string, id: string) {
  const { ws } = await ownPage(slug, id);
  await db.landingPage.updateMany({ where: { id, workspaceId: ws.id }, data: { status: "DRAFT", publishedData: Prisma.DbNull, publishedAt: null } });
  revalidatePath(`/sa/${slug}/seiten/${id}`);
  revalidatePath(`/sa/${slug}/seiten`);
}

export async function deletePage(slug: string, id: string) {
  const { ws } = await guard(slug, { object: "pages", action: "delete" });
  await db.landingPage.deleteMany({ where: { id, workspaceId: ws.id } });
  redirect(`/sa/${slug}/seiten`);
}

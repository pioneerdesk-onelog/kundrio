import "server-only";
import { cache } from "react";
import { db } from "./db";
import { env } from "./env";
import { publicPath } from "./p-meta";

// Öffentliche Abfragen: liefern ausschließlich veröffentlichte Seiten.

export const publicWorkspace = cache((slug: string) => db.workspace.findUnique({ where: { slug } }));

export const publishedPages = cache((workspaceId: string) =>
  db.landingPage.findMany({
    where: { workspaceId, status: "PUBLISHED", publishedAt: { not: null } },
    select: { id: true, groupId: true, slug: true, lang: true, title: true, seoTitle: true, seoDescription: true, publishedAt: true, updatedAt: true },
    orderBy: { publishedAt: "desc" },
  }),
);

export const absUrl = (path: string) => new URL(path, env.appUrl()).toString();
export const pageUrl = (wsSlug: string, lang: string, slug: string) => absUrl(publicPath(wsSlug, lang, slug));

/** Kurzbeschreibung aus der Wiki-Startseite (ohne Überschriften und Platzhalter). */
export async function workspaceSummary(workspaceId: string, fallback: string | null): Promise<string> {
  const start = await db.wikiPage.findUnique({ where: { workspaceId_slug: { workspaceId, slug: "start" } } });
  const text = (start?.body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^_?noch offen_?$/i.test(l) && !/^website:/i.test(l))
    .join(" ")
    .replace(/[*_`>]/g, "")
    .trim();
  const s = text || fallback || "";
  return s.length > 400 ? `${s.slice(0, 397)}…` : s;
}

export const jsonLd = (obj: unknown) => JSON.stringify(obj).replace(/</g, "\\u003c");

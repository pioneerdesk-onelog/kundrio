import "server-only";
import { headers } from "next/headers";
import type { LandingPage, Workspace } from "@prisma/client";
import { db } from "../db";
import { LANG_RE } from "../p-meta";
import { publishedPages } from "../p-public";
import { servableDomain } from "./service";
import type { SiteUrls } from "./view";

// Eigene Kundendomain: Workspace + Seite aus Host und Pfad auflösen, URLs auf die eigene Domain bilden.
// Startseite der Domain: veröffentlichte Seite mit slug „start“ in der Standardsprache, sonst die zuerst
// veröffentlichte Seite der Standardsprache (es gibt kein eigenes Feld „Startseite“).

export const defaultLang = (ws: Pick<Workspace, "languages">) => ws.languages[0] ?? "de";

/** Domain nur liefern, wenn die Anfrage wirklich über die Middleware kam (Header kann der Client nicht setzen). */
export async function domainForRequest(hostParam: string) {
  const h = await headers();
  const marked = h.get("x-pd-domain");
  if (!marked || marked !== decodeURIComponent(hostParam)) return null;
  return servableDomain(marked);
}

export async function startSlug(ws: Workspace, lang: string): Promise<string | null> {
  const pages = (await publishedPages(ws.id)).filter((p) => p.lang === lang);
  if (pages.some((p) => p.slug === "start")) return "start";
  const first = [...pages].sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0))[0];
  return first?.slug ?? null;
}

export function domainUrls(host: string, ws: Workspace, start: Record<string, string | null>): SiteUrls {
  const base = `https://${host}`;
  const dl = defaultLang(ws);
  const rel = (lang: string, slug: string) => {
    if (start[lang] === slug) return lang === dl ? "/" : `/${lang}`;
    return lang === dl ? `/${slug}` : `/${lang}/${slug}`;
  };
  return { page: (lang, slug) => `${base}${rel(lang, slug)}`, orgBase: `${base}/`, analyticsPath: (lang, slug) => rel(lang, slug) };
}

/** Pfadsegmente → Seite. [] Start, [slug], [lang], [lang, slug]. */
export async function resolveDomainPage(ws: Workspace, segments: string[]): Promise<{ page: LandingPage; start: Record<string, string | null> } | null> {
  const dl = defaultLang(ws);
  const segs = segments.map((s) => decodeURIComponent(s).toLowerCase());
  let lang = dl;
  let slug: string | null = null;
  if (segs.length === 0) slug = await startSlug(ws, dl);
  else if (segs.length === 1) {
    if (LANG_RE.test(segs[0]) && ws.languages.includes(segs[0]) && segs[0] !== dl) {
      lang = segs[0];
      slug = await startSlug(ws, lang);
    } else slug = segs[0];
  } else if (segs.length === 2 && LANG_RE.test(segs[0])) {
    lang = segs[0];
    slug = segs[1];
  } else return null;
  if (!slug) return null;
  const page = await db.landingPage.findFirst({ where: { workspaceId: ws.id, lang, slug, status: "PUBLISHED" } });
  if (!page || !page.publishedData) return null;
  const start: Record<string, string | null> = {};
  for (const l of ws.languages.length ? ws.languages : [dl]) start[l] = await startSlug(ws, l);
  return { page, start };
}

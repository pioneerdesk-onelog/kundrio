import { after } from "next/server";
import { recordServerHit } from "@/lib/analytics/track";
import { pageUrl, publicWorkspace, publishedPages } from "@/lib/p-public";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const ws = await publicWorkspace(slug);
  if (!ws) return new Response("Nicht gefunden", { status: 404 });
  after(() => recordServerHit({ workspaceId: ws.id, path: `/p/${ws.slug}/sitemap.xml`, headers: req.headers }));

  const pages = await publishedPages(ws.id);
  const urls = pages.map((p) => {
    const alts = pages
      .filter((s) => s.groupId === p.groupId)
      .map((s) => `    <xhtml:link rel="alternate" hreflang="${esc(s.lang)}" href="${esc(pageUrl(ws.slug, s.lang, s.slug))}"/>`)
      .join("\n");
    return `  <url>\n    <loc>${esc(pageUrl(ws.slug, p.lang, p.slug))}</loc>\n    <lastmod>${p.updatedAt.toISOString()}</lastmod>\n${alts}\n  </url>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}

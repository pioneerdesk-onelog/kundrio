import { after } from "next/server";
import { recordServerHit } from "@/lib/analytics/track";
import { LANG_NAMES } from "@/lib/p-meta";
import { absUrl, pageUrl, publicWorkspace, publishedPages, workspaceSummary } from "@/lib/p-public";

export const dynamic = "force-dynamic";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// llms.txt (Konvention llmstxt.org): kompakter Überblick für KI-Assistenten.
export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const ws = await publicWorkspace(slug);
  if (!ws) return new Response("Nicht gefunden", { status: 404 });
  after(() => recordServerHit({ workspaceId: ws.id, path: `/p/${ws.slug}/llms.txt`, headers: req.headers }));

  const [pages, summary] = await Promise.all([publishedPages(ws.id), workspaceSummary(ws.id, ws.description)]);
  const lines = [`# ${ws.name}`, ""];
  if (summary) lines.push(`> ${oneLine(summary)}`, "");
  if (ws.domain) lines.push(`Website: https://${ws.domain}`);
  if (ws.legalName) lines.push(`Anbieter: ${oneLine(ws.legalName)}`);
  lines.push("", "## Seiten", "");
  if (pages.length === 0) lines.push("- (noch keine veröffentlichten Seiten)");
  for (const p of pages) {
    const desc = p.seoDescription ? `: ${oneLine(p.seoDescription)}` : "";
    lines.push(`- [${oneLine(p.seoTitle || p.title)}](${pageUrl(ws.slug, p.lang, p.slug)}) (${LANG_NAMES[p.lang] ?? p.lang})${desc}`);
  }
  lines.push("", "## Für KI-Agenten", "");
  if (ws.agentApiEnabled) {
    lines.push(`- [Agent-API (OpenAPI)](${absUrl(`/api/agent/${ws.slug}/openapi.json`)}): Fragen zum Angebot stellen und Kontakt- oder Terminanfragen übermitteln`);
  }
  lines.push(`- [Sitemap](${absUrl(`/p/${ws.slug}/sitemap.xml`)})`, "");
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}

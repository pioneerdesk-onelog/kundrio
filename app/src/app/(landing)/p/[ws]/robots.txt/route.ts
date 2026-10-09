import { after } from "next/server";
import { recordServerHit } from "@/lib/analytics/track";
import { absUrl, publicWorkspace } from "@/lib/p-public";

export const dynamic = "force-dynamic";

// Hinweis: Suchmaschinen lesen robots.txt nur im Wurzelverzeichnis einer Domain.
// Diese Datei ist die Vorlage für die Domain des Sub-Accounts (bzw. gilt, sobald /p/<ws> auf einer eigenen Domain liegt).
export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const ws = await publicWorkspace(slug);
  if (!ws) return new Response("Nicht gefunden", { status: 404 });
  after(() => recordServerHit({ workspaceId: ws.id, path: `/p/${ws.slug}/robots.txt`, headers: req.headers }));

  const body = [
    `# ${ws.name} – Landingpages`,
    "# KI-Assistenten und Suchmaschinen sind ausdrücklich willkommen:",
    "# GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User,",
    "# PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, Bingbot, Googlebot",
    "",
    "User-agent: *",
    `Allow: /p/${ws.slug}/`,
    "Disallow: /sa/",
    "Disallow: /api/",
    "",
    `Sitemap: ${absUrl(`/p/${ws.slug}/sitemap.xml`)}`,
    `# llms.txt: ${absUrl(`/p/${ws.slug}/llms.txt`)}`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}

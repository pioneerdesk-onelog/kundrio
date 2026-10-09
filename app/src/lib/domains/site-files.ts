import "server-only";
import type { Workspace } from "@prisma/client";
import { LANG_NAMES } from "../p-meta";
import { absUrl, publishedPages, workspaceSummary } from "../p-public";
import { startSlug } from "./site";
import { domainUrls } from "./site";

// robots.txt, sitemap.xml und llms.txt im Wurzelverzeichnis einer eigenen Kundendomain.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

async function urls(host: string, ws: Workspace) {
  const start: Record<string, string | null> = {};
  for (const l of ws.languages.length ? ws.languages : ["de"]) start[l] = await startSlug(ws, l);
  return domainUrls(host, ws, start);
}

export function robotsTxt(host: string, ws: Workspace) {
  return [
    `# ${ws.name}`,
    "# KI-Assistenten und Suchmaschinen sind ausdrücklich willkommen:",
    "# GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User,",
    "# PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, Bingbot, Googlebot",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: https://${host}/sitemap.xml`,
    `# llms.txt: https://${host}/llms.txt`,
    "",
  ].join("\n");
}

export async function sitemapXml(host: string, ws: Workspace) {
  const u = await urls(host, ws);
  const pages = await publishedPages(ws.id);
  const items = pages.map((p) => {
    const alts = pages
      .filter((s) => s.groupId === p.groupId)
      .map((s) => `    <xhtml:link rel="alternate" hreflang="${esc(s.lang)}" href="${esc(u.page(s.lang, s.slug))}"/>`)
      .join("\n");
    return `  <url>\n    <loc>${esc(u.page(p.lang, p.slug))}</loc>\n    <lastmod>${p.updatedAt.toISOString()}</lastmod>\n${alts}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${items.join("\n")}\n</urlset>\n`;
}

export async function llmsTxt(host: string, ws: Workspace) {
  const u = await urls(host, ws);
  const [pages, summary] = await Promise.all([publishedPages(ws.id), workspaceSummary(ws.id, ws.description)]);
  const lines = [`# ${ws.name}`, ""];
  if (summary) lines.push(`> ${oneLine(summary)}`, "");
  if (ws.domain) lines.push(`Website: https://${ws.domain}`);
  if (ws.legalName) lines.push(`Anbieter: ${oneLine(ws.legalName)}`);
  lines.push("", "## Seiten", "");
  if (pages.length === 0) lines.push("- (noch keine veröffentlichten Seiten)");
  for (const p of pages) lines.push(`- [${oneLine(p.seoTitle || p.title)}](${u.page(p.lang, p.slug)}) (${LANG_NAMES[p.lang] ?? p.lang})${p.seoDescription ? `: ${oneLine(p.seoDescription)}` : ""}`);
  lines.push("", "## Für KI-Agenten", "");
  if (ws.agentApiEnabled) lines.push(`- [Agent-API (OpenAPI)](${absUrl(`/api/agent/${ws.slug}/openapi.json`)}): Fragen zum Angebot stellen und Kontakt- oder Terminanfragen übermitteln`);
  lines.push(`- [Sitemap](https://${host}/sitemap.xml)`, "");
  return lines.join("\n");
}

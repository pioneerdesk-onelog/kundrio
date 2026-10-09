import { after } from "next/server";
import { recordServerHit } from "@/lib/analytics/track";
import { domainForRequest } from "@/lib/domains/site";
import { robotsTxt } from "@/lib/domains/site-files";

export const dynamic = "force-dynamic";

// /robots.txt im Wurzelverzeichnis einer eigenen Kundendomain (über die Middleware umgeschrieben)
export async function GET(req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const d = await domainForRequest(host);
  if (!d) return new Response("Nicht gefunden", { status: 404 });
  after(() => recordServerHit({ workspaceId: d.workspaceId, path: "/robots.txt", headers: req.headers }));
  const body = robotsTxt(d.hostname, d.workspace);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}

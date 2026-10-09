import { after } from "next/server";
import { recordServerHit } from "@/lib/analytics/track";
import { domainForRequest } from "@/lib/domains/site";
import { llmsTxt } from "@/lib/domains/site-files";

export const dynamic = "force-dynamic";

// /llms.txt im Wurzelverzeichnis einer eigenen Kundendomain (über die Middleware umgeschrieben)
export async function GET(req: Request, { params }: { params: Promise<{ host: string }> }) {
  const { host } = await params;
  const d = await domainForRequest(host);
  if (!d) return new Response("Nicht gefunden", { status: 404 });
  after(() => recordServerHit({ workspaceId: d.workspaceId, path: "/llms.txt", headers: req.headers }));
  const body = await llmsTxt(d.hostname, d.workspace);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}

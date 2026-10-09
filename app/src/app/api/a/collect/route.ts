import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimitAsync } from "@/lib/ratelimit";
import { clientIp, storeEvent, visitorHash } from "@/lib/analytics/store";
import { allowedOriginsFor, corsHeaders, requestOrigin } from "@/lib/analytics/origins";

// Cookiefreier Sammel-Endpunkt für Beacon und Einbett-Skript.
// Body kommt als text/plain (kein CORS-Preflight bei sendBeacon), Inhalt ist JSON.

const MAX_BODY = 4096;

const schema = z.object({
  ws: z.string().min(1).max(60),
  k: z.enum(["pageview", "event"]).default("pageview"),
  n: z.string().max(120).optional(), // Ereignisname bei k=event
  u: z.string().max(2000), // location.href
  r: z.string().max(2000).optional(), // document.referrer
  p: z.string().max(40).optional(), // pageId (Landingpage)
});

const noContent = (headers?: HeadersInit) => new Response(null, { status: 204, headers });

export async function OPTIONS(req: Request) {
  const origin = requestOrigin(req.headers);
  return noContent(corsHeaders(origin));
}

export async function POST(req: Request) {
  const h = req.headers;
  if (!await rateLimitAsync(`collect:${clientIp(h)}`, 120, 60_000)) return new Response(null, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });
  const d = parsed.data;

  const ws = await db.workspace.findUnique({ where: { slug: d.ws }, select: { id: true, domain: true, allowedOrigins: true } });
  if (!ws) return noContent();

  // Nur erlaubte Websites dürfen Daten senden
  const origin = requestOrigin(h);
  if (!origin || !allowedOriginsFor(ws, req.url).has(origin)) return new Response(null, { status: 403, headers: corsHeaders(null) });
  const cors = corsHeaders(origin);

  let page: URL;
  try {
    page = new URL(d.u);
  } catch {
    return new Response(null, { status: 400, headers: cors });
  }

  // Angemeldete CRM-Benutzer (eigene Besuche) als „audit“ markieren statt zu zählen
  const user = await getCurrentUser().catch(() => null);

  await storeEvent({
    workspaceId: ws.id,
    kind: user ? "audit" : d.k,
    name: d.k === "event" ? d.n : null,
    host: page.host,
    path: page.pathname,
    pageId: d.p,
    referrer: d.r,
    utm: {
      source: page.searchParams.get("utm_source"),
      medium: page.searchParams.get("utm_medium"),
      campaign: page.searchParams.get("utm_campaign"),
    },
    ua: h.get("user-agent"),
    acceptLanguage: h.get("accept-language"),
    visitorHash: await visitorHash(ws.id, h),
  });
  return noContent(cors);
}

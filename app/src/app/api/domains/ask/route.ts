import { timingSafeEqual } from "node:crypto";
import { servableDomain } from "@/lib/domains/service";

// Caddy On-Demand-TLS „ask“: Caddy fragt vor der Zertifikatsausstellung, ob der Hostname zu uns gehört.
// 200 nur für eingetragene Landingpage-Domains in Prüfung oder aktiv. Geschützt per Geheimnis (CADDY_ASK_SECRET).
// Caddyfile: on_demand_tls { ask http://app:3000/api/domains/ask?secret=… } – Caddy hängt &domain=<host> an.

export const dynamic = "force-dynamic";

function secretOk(given: string | null) {
  const expected = process.env.CADDY_ASK_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!secretOk(url.searchParams.get("secret"))) return new Response("forbidden", { status: 403 });
  const domain = url.searchParams.get("domain") ?? "";
  const d = await servableDomain(domain).catch(() => null);
  return new Response(d ? "ok" : "unknown", { status: d ? 200 : 404 });
}

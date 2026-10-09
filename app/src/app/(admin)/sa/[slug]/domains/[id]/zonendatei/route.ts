import { db } from "@/lib/db";
import { hasSpecial } from "@/lib/permissions";
import { routeGuard } from "@/lib/permissions/guard";
import { exportZoneFile } from "@/lib/domains/stackit-migration";
import { audit } from "@/lib/audit";

// Zonendatei (BIND) herunterladen – Rückweg/Weitergabe an jeden anderen DNS-Anbieter (kein Lock-in).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const g = await routeGuard(slug, { special: "manage_settings" });
  if (g instanceof Response) return g;
  if (!hasSpecial(g.access, "export")) return new Response("Für den Export fehlt die Berechtigung.", { status: 403 });
  const d = await db.domain.findFirst({ where: { id, workspaceId: g.ws.id } });
  if (!d) return new Response("Nicht gefunden", { status: 404 });
  const z = await exportZoneFile(d);
  await audit({ workspaceId: g.ws.id, actor: `user:${g.user.id}`, action: "domain.zonefile_exported", target: d.id, detail: { source: z.source } });
  return new Response(z.text, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${z.filename}"`, "cache-control": "no-store" } });
}

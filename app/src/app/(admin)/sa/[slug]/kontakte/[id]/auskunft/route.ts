import { NextResponse } from "next/server";
import { can, hasSpecial } from "@/lib/permissions";
import { routeGuard } from "@/lib/permissions/guard";
import { buildContactAccessReport } from "@/lib/privacy/access";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Auskunft nach Art. 15 DSGVO (und Datenübertragbarkeit Art. 20) für einen Kontakt als JSON-Datei
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const g = await routeGuard(slug, { object: "contacts", action: "read" });
  if (g instanceof Response) return g;
  const { ws, access } = g;
  if (!hasSpecial(access, "export")) return new NextResponse("Dafür fehlt das Recht „Daten exportieren“.", { status: 403 });
  const owner = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { ownerId: true } });
  // Außerhalb der Reichweite wie „nicht gefunden“ (verrät keine Existenz)
  if (!owner || !can(access, "contacts", "read", owner.ownerId)) return new NextResponse("Nicht gefunden", { status: 404 });
  const report = await buildContactAccessReport(ws.id, id);
  if (!report) return new NextResponse("Nicht gefunden", { status: 404 });
  await audit({ workspaceId: ws.id, actor: `user:${access.userId}`, action: "contact.access_report", target: id });
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(report, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="auskunft-${id}-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}

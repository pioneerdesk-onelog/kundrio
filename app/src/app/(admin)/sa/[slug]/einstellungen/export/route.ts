import { NextResponse } from "next/server";
import { hasSpecial } from "@/lib/permissions";
import { routeGuard } from "@/lib/permissions/guard";
import { workspaceZip } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Vollständiger Export aller Tabellen: Einstellungen verwalten + Daten exportieren
  const g = await routeGuard(slug, { special: "manage_settings" });
  if (g instanceof Response) return g;
  const { ws, access } = g;
  if (!hasSpecial(access, "export")) return new NextResponse("Dafür fehlt das Recht „Daten exportieren“.", { status: 403 });
  const body = await workspaceZip(ws.id);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(body), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="export-${ws.slug}-${date}.zip"`,
      "cache-control": "no-store",
    },
  });
}

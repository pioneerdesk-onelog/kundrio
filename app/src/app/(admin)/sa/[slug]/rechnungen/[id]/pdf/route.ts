import { db } from "@/lib/db";
import { routeGuard } from "@/lib/permissions/guard";
import { documentPdf } from "@/lib/documents/send";

export const dynamic = "force-dynamic";

// PDF eines Belegs (Ansicht/Download). Einzelbeleg → Leserecht für Rechnungen genügt.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const g = await routeGuard(slug, { object: "invoices", action: "read" });
  if (g instanceof Response) return g;
  const exists = await db.invoice.findFirst({ where: { id, workspaceId: g.ws.id }, select: { id: true } });
  if (!exists) return new Response("Beleg nicht gefunden", { status: 404 });
  const { bytes, filename } = await documentPdf(g.ws.id, id, `user:${g.user.id}`);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  });
}

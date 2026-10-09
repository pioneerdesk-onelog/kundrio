import { db } from "@/lib/db";
import { routeGuard } from "@/lib/permissions/guard";
import { readStoredFile } from "@/lib/storage";

// Hochgeladener Mandatsnachweis (nur Download, nie inline).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const g = await routeGuard(slug, { object: "invoices", action: "read" });
  if (g instanceof Response) return g;
  const m = await db.sepaMandate.findFirst({ where: { id, workspaceId: g.ws.id } });
  const f = m?.proofFileId ? await readStoredFile(g.ws.id, m.proofFileId) : null;
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(Buffer.from(f.data), {
    headers: { "content-type": f.file.mime, "content-disposition": `attachment; filename="${f.file.name.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "no-store" },
  });
}

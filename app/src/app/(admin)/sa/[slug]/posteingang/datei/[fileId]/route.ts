import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";
import { routeGuard } from "@/lib/permissions/guard";

// Anhänge aus dem Posteingang – nur mit Leserecht E-Mail und nur, wenn die Datei zu einer Nachricht
// dieses Sub-Accounts gehört. Immer als Download, nie inline (kein Ausführen im Browser).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; fileId: string }> }) {
  const { slug, fileId } = await params;
  const g = await routeGuard(slug, { object: "email", action: "read" });
  if (g instanceof Response) return g;
  const linked = await db.message.findFirst({
    where: { workspaceId: g.ws.id, attachments: { array_contains: [{ fileId }] } },
    select: { id: true },
  });
  if (!linked) return new Response("Nicht gefunden", { status: 404 });
  const f = await readStoredFile(g.ws.id, fileId);
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  return new Response(Buffer.from(f.data), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(f.file.name)}"; filename*=UTF-8''${encodeURIComponent(f.file.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, no-store",
    },
  });
}

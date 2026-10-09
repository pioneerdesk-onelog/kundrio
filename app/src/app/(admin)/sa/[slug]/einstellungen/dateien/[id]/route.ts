import { routeGuard } from "@/lib/permissions/guard";
import { readStoredFile } from "@/lib/storage";

// Geschützte Auslieferung hochgeladener Dateien – immer als Download, nie inline (kein Ausführen von SVG/HTML).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const ctx = await routeGuard(slug, { special: "manage_settings" });
  if (ctx instanceof Response) return ctx;
  const r = await readStoredFile(ctx.ws.id, id);
  if (!r) return new Response("Nicht gefunden", { status: 404 });
  const ascii = r.file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(r.data), {
    headers: {
      "content-type": r.file.mime,
      "content-length": String(r.data.length),
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.file.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
    },
  });
}

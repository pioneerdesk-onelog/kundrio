import { routeGuard } from "@/lib/permissions/guard";
import { BillingError, exportDebitBatch } from "@/lib/billing/service";

// pain.008-Datei eines Stapels. Wird aus den gespeicherten Daten erzeugt (gleiche Nachrichten-ID) – nichts im Dateispeicher.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const g = await routeGuard(slug, { object: "invoices", action: "edit" });
  if (g instanceof Response) return g;
  try {
    const { xml, filename } = await exportDebitBatch(g.ws.id, id, `user:${g.user.id}`);
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof BillingError || (e instanceof Error && /pain\.008|Gläubiger|IBAN|Mandat/.test(e.message))) return new Response(e.message, { status: 422 });
    throw e;
  }
}

import { db } from "@/lib/db";
import { routeGuard } from "@/lib/permissions/guard";
import { renderMandatePdf } from "@/lib/billing/mandate-pdf";

// Mandatsformular als PDF zum Unterschreiben (IBAN maskiert – der Kunde trägt sie selbst ein bzw. prüft sie).
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const g = await routeGuard(slug, { object: "invoices", action: "read" });
  if (g instanceof Response) return g;
  const m = await db.sepaMandate.findFirst({ where: { id, workspaceId: g.ws.id }, include: { contact: true } });
  if (!m) return new Response("Nicht gefunden", { status: 404 });
  if (!g.ws.creditorId) return new Response("Gläubiger-ID fehlt (Einstellungen).", { status: 409 });
  const bytes = await renderMandatePdf({
    creditorName: g.ws.legalName ?? g.ws.name,
    creditorAddress: g.ws.legalAddress,
    creditorId: g.ws.creditorId,
    mandateRef: m.mandateRef,
    scheme: m.scheme,
    recurring: true,
    debtorName: m.accountHolder,
    debtorAddress: null,
    ibanMasked: `··· ${m.ibanLast4}`,
    bic: m.bic,
  });
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="SEPA-Mandat-${m.mandateRef}.pdf"`, "cache-control": "no-store" },
  });
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeGuard } from "@/lib/permissions/guard";
import { parseItems } from "@/lib/invoice";
import { buildXRechnung, xrechnungMissing, type XRechnungInput } from "@/lib/xrechnung";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  // Einzelbeleg (kein Massenexport) → Leserecht für Rechnungen genügt
  const g = await routeGuard(slug, { object: "invoices", action: "read" });
  if (g instanceof Response) return g;
  const { ws } = g;
  const inv = await db.invoice.findFirst({ where: { id, workspaceId: ws.id, kind: "INVOICE" }, include: { contact: true } });
  if (!inv) return new NextResponse("Rechnung nicht gefunden", { status: 404 });

  const input: XRechnungInput = {
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    servicePeriod: inv.serviceFrom && inv.serviceTo ? { from: inv.serviceFrom, to: inv.serviceTo } : null,
    // nur ein Datum angegeben → als Leistungsdatum (BT-72)
    deliveryDate: inv.serviceTo ? null : inv.serviceFrom,
    taxExemptionReason: inv.taxExemptionReason,
    buyerReference: inv.buyerReference ?? "",
    notes: inv.notes,
    items: parseItems(inv.items),
    seller: {
      name: ws.legalName ?? "",
      address: ws.legalAddress ?? "",
      vatId: ws.vatId ?? "",
      email: ws.legalEmail ?? ws.mailFromEmail ?? "",
      contactName: ws.mailFromName ?? ws.legalName ?? "",
      phone: ws.legalPhone,
      iban: ws.iban ?? "",
      bic: ws.bic,
    },
    buyer: { name: inv.buyerName ?? "", address: inv.buyerAddress ?? "", email: inv.buyerEmail ?? inv.contact?.email ?? "" },
  };
  const missing = xrechnungMissing(input);
  if (missing.length) {
    return new NextResponse(`XRechnung kann nicht erzeugt werden. Es fehlen: ${missing.join(", ")}`, {
      status: 422,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse(buildXRechnung(input), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="xrechnung-${inv.number}.xml"`,
      "cache-control": "no-store",
    },
  });
}

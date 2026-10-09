import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { NoAccess } from "@/components/users/NoAccess";
import { Card, PageHeader } from "@/components/ui";
import { saveInvoice } from "../actions";
import { InvoiceForm } from "../InvoiceForm";
import { resolveTexts } from "@/lib/documents/texts";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ art?: string; kontakt?: string }> }) {
  const { slug } = await params;
  const { art, kontakt } = await searchParams;
  const { ws, access } = await pageAccess(slug);
  if (!can(access, "invoices", "edit")) return <NoAccess what="das Anlegen von Angeboten und Rechnungen" />;
  const kind = art === "QUOTE" ? "QUOTE" : "INVOICE";
  const contacts = await db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true, company: true } });
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + (kind === "QUOTE" ? 30 : 14) * 86400_000).toISOString().slice(0, 10);
  const pre = kontakt ? contacts.find((c) => c.id === kontakt) : undefined;
  const name = (c: (typeof contacts)[number]) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Kontakt";
  return (
    <div>
      <PageHeader title={kind === "QUOTE" ? "Neues Angebot" : "Neue Rechnung"} description="Die Nummer wird beim Speichern fortlaufend vergeben." />
      <Card>
        <InvoiceForm
          action={saveInvoice.bind(null, slug, null)}
          defaultTexts={{ intro: resolveTexts(ws.documentTexts)[kind].intro, outro: resolveTexts(ws.documentTexts)[kind].outro }}
          locked={false}
          contacts={contacts.map((c) => ({ id: c.id, name: name(c), email: c.email, company: c.company }))}
          initial={{ kind, contactId: pre?.id ?? null, issueDate: today, dueDate: due, buyerName: pre ? pre.company || name(pre) : "", buyerAddress: "", buyerReference: "", notes: "", items: [], buyerEmail: pre?.email ?? "", serviceFrom: "", serviceTo: "", taxExemptionReason: "" }}
        />
      </Card>
    </div>
  );
}

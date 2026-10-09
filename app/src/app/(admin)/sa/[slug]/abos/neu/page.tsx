import { db } from "@/lib/db";
import { assertCan } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { isoDay } from "@/lib/billing/periods";
import { Card, PageHeader } from "@/components/ui";
import { SubscriptionForm } from "@/components/billing/forms";
import { createSubscriptionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewSubscriptionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  assertCan(access, "invoices", "edit");
  const [contacts, products, mandates] = await Promise.all([
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: [{ company: "asc" }, { lastName: "asc" }], take: 1000, select: { id: true, firstName: true, lastName: true, company: true, email: true } }),
    db.product.findMany({ where: { workspaceId: ws.id, active: true }, orderBy: { name: "asc" } }),
    db.sepaMandate.findMany({ where: { workspaceId: ws.id, status: "active" }, select: { id: true, contactId: true, mandateRef: true, ibanLast4: true } }),
  ]);
  const label = (c: (typeof contacts)[number]) => [c.company, [c.firstName, c.lastName].filter(Boolean).join(" "), c.email].filter(Boolean).join(" · ");
  return (
    <div className="space-y-6">
      <PageHeader title="Neues Abo" description="Rechnungen entstehen automatisch zum Abrechnungstermin – zunächst als Entwurf." />
      <Card>
        <SubscriptionForm
          action={createSubscriptionAction.bind(null, slug)}
          contacts={contacts.map((c) => ({ id: c.id, label: label(c) }))}
          products={products.map((p) => ({ id: p.id, name: p.name, unitCents: p.unitCents, vatRate: p.vatRate, interval: p.interval }))}
          mandates={mandates.map((m) => ({ id: m.id, contactId: m.contactId, label: `${m.mandateRef} · IBAN ···${m.ibanLast4}` }))}
          today={isoDay(new Date())}
        />
      </Card>
    </div>
  );
}

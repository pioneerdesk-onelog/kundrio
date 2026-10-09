import Link from "next/link";
import { db } from "@/lib/db";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { DOC_KINDS, KIND_LABEL, isDocKind, type DocKind } from "@/lib/invoice";
import { DEFAULT_TEXTS, buildDocContext, resolveTexts } from "@/lib/documents/texts";
import { TextsEditor } from "@/components/documents/TextsEditor";
import { Card, PageHeader, btnGhostCls } from "@/components/ui";
import { resetDocumentTexts, saveDocumentTexts, suggestDocumentText } from "./actions";

export const dynamic = "force-dynamic";

// Standardtexte je Belegart (Angebot, Auftragsbestätigung, Rechnung) mit Platzhaltern und Live-Vorschau.
export default async function TextsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ art?: string }> }) {
  const { slug } = await params;
  const { art } = await searchParams;
  const { ws, access, user } = await pageAccess(slug);
  const kind: DocKind = isDocKind(art) ? art : "QUOTE";
  const canEdit = can(access, "invoices", "edit") && hasSpecial(access, "manage_settings");
  const texts = resolveTexts(ws.documentTexts);

  // Echter Beispielbeleg dieser Art (sonst ein beliebiger Beleg, sonst Beispieldaten)
  const sampleDoc =
    (await db.invoice.findFirst({ where: { workspaceId: ws.id, kind }, orderBy: { createdAt: "desc" }, include: { contact: true } })) ??
    (await db.invoice.findFirst({ where: { workspaceId: ws.id }, orderBy: { createdAt: "desc" }, include: { contact: true } }));
  const now = new Date();
  const sample = buildDocContext(
    sampleDoc
      ? { ...sampleDoc, kind }
      : { kind, number: `${kind === "QUOTE" ? "AN" : kind === "ORDER" ? "AB" : "RE"}-${now.getFullYear()}-0001`, issueDate: now, dueDate: new Date(now.getTime() + 14 * 864e5), serviceFrom: null, serviceTo: null, netCents: 100000, grossCents: 119000, currency: "EUR", buyerName: "Muster GmbH", customerOrderRef: "B-4711" },
    sampleDoc?.contact ? { firstName: sampleDoc.contact.firstName, lastName: sampleDoc.contact.lastName, company: sampleDoc.contact.company } : { firstName: "Erika", lastName: "Muster", company: "Muster GmbH" },
    { companyName: ws.legalName ?? ws.name, userName: user.name, email: ws.legalEmail ?? ws.mailFromEmail, phone: ws.legalPhone },
    { acceptUrl: kind === "QUOTE" ? `${process.env.APP_URL ?? ""}/dokument/…` : null, paymentUrl: kind === "INVOICE" ? `${process.env.APP_URL ?? ""}/zahlung/…` : null },
  );
  const chip = (active: boolean) => `rounded-full px-3 py-1 text-sm ${active ? "bg-accent-500 text-white" : "bg-sand-100 text-ink-800 hover:bg-sand-200 dark:bg-white/10 dark:text-ink-100"}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Texte & Vorlagen" description="Einleitung, Schlusstext, Zahlungsbedingungen und E-Mail je Belegart. Platzhalter werden beim Erstellen und Versenden mit den Daten des Belegs gefüllt.">
        <Link href={`/sa/${slug}/rechnungen`} className={btnGhostCls}>Zurück zur Liste</Link>
      </PageHeader>
      <nav aria-label="Belegart" className="flex flex-wrap gap-2">
        {DOC_KINDS.map((k) => (
          <Link key={k} href={`/sa/${slug}/rechnungen/texte?art=${k}`} className={chip(k === kind)} aria-current={k === kind ? "page" : undefined}>
            {KIND_LABEL[k]}
          </Link>
        ))}
      </nav>
      {!canEdit && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Ansicht: Standardtexte ändern dürfen Personen mit den Rechten „Rechnungen bearbeiten“ und „Einstellungen verwalten“. Einzelne Belege lassen sich trotzdem individuell anpassen.
        </p>
      )}
      <Card>
        <TextsEditor
          key={kind}
          kindLabel={KIND_LABEL[kind]}
          initial={texts[kind]}
          defaults={DEFAULT_TEXTS[kind]}
          sample={sample}
          sampleLabel={sampleDoc ? `Beleg ${sampleDoc.number}` : "Beispieldaten"}
          action={saveDocumentTexts.bind(null, slug, kind)}
          suggest={async (input) => {
            "use server";
            return suggestDocumentText(slug, { kind, field: input.field, current: input.current, wish: input.wish });
          }}
          canEdit={canEdit}
          showPaymentTerms={kind !== "QUOTE"}
        />
      </Card>
      {canEdit && (
        <form action={resetDocumentTexts.bind(null, slug, kind)}>
          <button className={btnGhostCls}>Alle Texte für „{KIND_LABEL[kind]}“ auf Standard zurücksetzen</button>
        </form>
      )}
    </div>
  );
}

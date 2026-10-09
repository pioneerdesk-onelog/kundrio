import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, FileCode2, FileText, Printer } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { formatCents, isDocKind, KIND_LABEL, parseItems, STATUS_LABEL, type DocKind } from "@/lib/invoice";
import { xrechnungMissing } from "@/lib/xrechnung";
import { documentChain } from "@/lib/documents/flow";
import { prepareDocumentMail } from "@/lib/documents/send";
import { resolveTexts } from "@/lib/documents/texts";
import { Badge, Card, PageHeader, btnCls, btnDangerCls, btnGhostCls, inputCls } from "@/components/ui";
import { SendDocument } from "@/components/documents/SendDocument";
import { PayButton } from "@/components/payments/PayButton";
import { convertToInvoice, createOrder, deleteDraft, markAccepted, saveInvoice, sendDocumentAction, setStatus } from "../actions";
import { InvoiceForm } from "../InvoiceForm";
import { LexwareInvoicePanel } from "../../integrationen/LexwareInvoicePanel";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { can, hasSpecial } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const DUNNING_LABEL: Record<number, string> = { 0: "keine", 1: "Zahlungserinnerung", 2: "1. Mahnung", 3: "Letzte Mahnung" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ ok?: string; fehler?: string }> }) {
  const { slug, id } = await params;
  const { ok, fehler } = await searchParams;
  const { ws, access, user } = await pageAccess(slug);
  const mayEdit = can(access, "invoices", "edit");
  const inv = await db.invoice.findFirst({ where: { id, workspaceId: ws.id }, include: { contact: true } });
  if (!inv) notFound();
  const kind: DocKind = isDocKind(inv.kind) ? inv.kind : "INVOICE";
  const contacts = await db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "desc" }, take: 500, select: { id: true, firstName: true, lastName: true, email: true, company: true } });
  const name = (c: (typeof contacts)[number]) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Kontakt";
  const items = parseItems(inv.items);
  const locked = (kind === "INVOICE" || kind === "ORDER") && inv.status !== "DRAFT";
  const missing = kind === "INVOICE"
    ? xrechnungMissing({
        buyerReference: inv.buyerReference ?? "",
        items,
        servicePeriod: inv.serviceFrom && inv.serviceTo ? { from: inv.serviceFrom, to: inv.serviceTo } : null,
        taxExemptionReason: inv.taxExemptionReason,
        seller: { name: ws.legalName ?? "", address: ws.legalAddress ?? "", vatId: ws.vatId ?? "", email: ws.legalEmail ?? ws.mailFromEmail ?? "", contactName: ws.legalName ?? "", phone: ws.legalPhone, iban: ws.iban ?? "", bic: ws.bic },
        buyer: { name: inv.buyerName ?? "", address: inv.buyerAddress ?? "", email: inv.buyerEmail ?? inv.contact?.email ?? "" },
      })
    : [];
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const chain = await documentChain(ws.id, inv.id);
  const hasOrder = chain.some((c) => c.kind === "ORDER" && c.status !== "CANCELLED");
  const hasInvoice = chain.some((c) => c.kind === "INVOICE" && c.status !== "CANCELLED");
  const draft = mayEdit && inv.status !== "CANCELLED" ? await prepareDocumentMail(ws.id, inv.id, `user:${user.id}`) : null;
  const needsApproval = !hasSpecial(access, "approve") || ws.fourEyes;
  // Standardtexte (mit Platzhaltern) als Vorlage im Formular
  const t = resolveTexts(ws.documentTexts)[kind];
  const dunningApprovals = await db.approval.findMany({
    where: { workspaceId: ws.id, kind: "dunning.send", payload: { path: ["invoiceId"], equals: inv.id } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, status: true, createdAt: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader title={`${KIND_LABEL[kind]} ${inv.number}`}>
        <Link href={`/sa/${slug}/rechnungen/${id}/druck`} className={btnGhostCls}><Printer size={16} aria-hidden /> Druckansicht</Link>
        <a href={`/sa/${slug}/rechnungen/${id}/pdf`} target="_blank" rel="noreferrer" className={btnGhostCls}><FileText size={16} aria-hidden /> PDF</a>
        {kind === "INVOICE" && <Link href={`/sa/${slug}/rechnungen/${id}/xrechnung`} prefetch={false} className={btnGhostCls}><FileCode2 size={16} aria-hidden /> XRechnung</Link>}
        {mayEdit && kind === "ORDER" && inv.status !== "CANCELLED" && !hasInvoice && (
          <form action={convertToInvoice.bind(null, slug, id)}><button className={btnCls}>In Rechnung umwandeln</button></form>
        )}
      </PageHeader>
      {(ok || fehler) && (
        <p role={fehler ? "alert" : "status"} className={`rounded-md border p-3 text-[15px] ${fehler ? "border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100"}`}>
          {fehler ?? ok}
        </p>
      )}

      {/* Abo-Bezug, Zahlweg und Mahnhistorie */}
      {(inv.subscriptionId || inv.dunningLevel > 0 || dunningApprovals.length > 0 || inv.paymentMethod === "sepa") && (
        <Card title="Abo & Zahlung">
          <dl className="grid gap-2 text-[15px] sm:grid-cols-3">
            <div>
              <dt className="text-ink-400 dark:text-ink-200">Abo</dt>
              <dd>{inv.subscriptionId ? <Link className="text-accent-500 dark:text-accent-100 hover:underline" href={`/sa/${slug}/abos/${inv.subscriptionId}`}>Zum Abo</Link> : "–"}</dd>
            </div>
            <div>
              <dt className="text-ink-400 dark:text-ink-200">Zahlweg</dt>
              <dd>{inv.paymentMethod === "sepa" ? "SEPA-Lastschrift" : "Überweisung"}</dd>
            </div>
            <div>
              <dt className="text-ink-400 dark:text-ink-200">Mahnstufe</dt>
              <dd>{DUNNING_LABEL[inv.dunningLevel] ?? `Stufe ${inv.dunningLevel}`}{inv.dunnedAt ? ` (seit ${inv.dunnedAt.toLocaleDateString("de-DE")})` : ""}</dd>
            </div>
          </dl>
          {dunningApprovals.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-ink-600 dark:text-ink-200">
              {dunningApprovals.map((a) => (
                <li key={a.id}>
                  {a.createdAt.toLocaleDateString("de-DE")} · {a.title} · <Badge tone={a.status === "approved" ? "ok" : a.status === "pending" ? "warn" : "neutral"}>{a.status === "approved" ? "versendet" : a.status === "pending" ? "wartet auf Freigabe" : a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Belegkette: Angebot → Auftragsbestätigung → Rechnung */}
      {chain.length > 1 && (
        <Card title="Belegkette">
          <ol className="flex flex-wrap items-center gap-2 text-[15px]">
            {chain.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2">
                {i > 0 && <ArrowRight size={16} className="text-ink-400" aria-hidden />}
                <Link href={`/sa/${slug}/rechnungen/${c.id}`} aria-current={c.id === inv.id ? "page" : undefined} className={`rounded-md border px-3 py-1.5 ${c.id === inv.id ? "border-accent-500 font-semibold" : "border-ink-100 hover:bg-sand-100 dark:border-white/10 dark:hover:bg-white/10"}`}>
                  {isDocKind(c.kind) ? KIND_LABEL[c.kind] : c.kind} <span className="font-mono">{c.number}</span>
                  <span className="ml-2 text-sm text-ink-400">{STATUS_LABEL[c.status] ?? c.status} · {formatCents(c.grossCents, c.currency)} · {formatDate(c.issueDate)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Angebot: annehmen → Auftragsbestätigung oder direkt Rechnung */}
      {mayEdit && kind === "QUOTE" && inv.status !== "CANCELLED" && (
        <Card title="Nächster Schritt">
          <div className="flex flex-wrap items-end gap-4">
            {!hasOrder && (
              <form action={createOrder.bind(null, slug, id)} className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="ref" className="mb-1 block text-sm font-medium">Bestellnummer des Kunden (optional)</label>
                  <input id="ref" name="customerOrderRef" maxLength={100} defaultValue={inv.customerOrderRef ?? ""} className={`${inputCls} w-56`} />
                </div>
                <button className={btnCls}>Auftragsbestätigung erstellen</button>
              </form>
            )}
            {inv.status !== "ACCEPTED" && (
              <form action={markAccepted.bind(null, slug, id)}>
                <input type="hidden" name="customerOrderRef" value={inv.customerOrderRef ?? ""} />
                <button className={btnGhostCls}>Nur als angenommen markieren</button>
              </form>
            )}
            {!hasInvoice && <form action={convertToInvoice.bind(null, slug, id)}><button className={btnGhostCls}>Direkt in Rechnung umwandeln</button></form>}
          </div>
          <p className="mt-2 text-sm text-ink-400 dark:text-ink-200">Die Auftragsbestätigung übernimmt Positionen, Kunde und Leistungszeitraum. Das Angebot gilt danach als angenommen.</p>
        </Card>
      )}

      {/* Lexware: Übertragung in die Buchhaltung (nur mit Recht „Rechnungen bearbeiten“, Aktion prüft erneut) */}
      <LexwareInvoicePanel slug={slug} workspaceId={ws.id} invoiceId={inv.id} canEdit={mayEdit} />

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Badge tone="accent">{STATUS_LABEL[inv.status] ?? inv.status}</Badge>
          {kind === "INVOICE" && <PayButton workspaceId={ws.id} invoiceId={inv.id} variant="admin" />}
          {inv.customerOrderRef && <span className="text-[15px] text-ink-600 dark:text-ink-200">Bestellung des Kunden: <strong>{inv.customerOrderRef}</strong></span>}
          {mayEdit && <form action={setStatus.bind(null, slug, id)} className="flex items-center gap-2">
            <label htmlFor="status" className="text-sm text-ink-600">Status ändern</label>
            <select id="status" name="status" defaultValue={inv.status} className={`${inputCls} w-40`}>
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className={btnGhostCls}>Setzen</button>
          </form>}
          {inv.status === "DRAFT" && can(access, "invoices", "delete") && (
            <form action={deleteDraft.bind(null, slug, id)} className="ml-auto">
              <button className={btnDangerCls}>{kind === "QUOTE" ? "Entwurf löschen" : "Entwurf verwerfen (storniert)"}</button>
            </form>
          )}
        </div>
        {locked && <p className="mt-3 text-[15px] text-ink-600 dark:text-ink-200">Dieser Beleg ist versendet und kann nicht mehr geändert werden (GoBD). Bei Fehlern: stornieren und neu erstellen.</p>}
        {missing.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            Für eine gültige XRechnung fehlen: {missing.join(", ")}. Firmendaten unter <Link className="underline" href={`/sa/${slug}/einstellungen`}>Einstellungen</Link>.
          </div>
        )}
      </Card>

      {draft && (
        <Card title="Per E-Mail senden">
          <SendDocument
            action={sendDocumentAction.bind(null, slug, id)}
            draft={{ to: draft.to, subject: draft.subject, body: draft.body }}
            isQuote={kind === "QUOTE" && inv.status !== "ACCEPTED"}
            needsApproval={needsApproval}
            pdfHref={`/sa/${slug}/rechnungen/${id}/pdf`}
          />
          <p className="mt-2 text-sm text-ink-400 dark:text-ink-200">
            Vorlage anpassen unter <Link className="underline" href={`/sa/${slug}/rechnungen/texte?art=${kind}`}>Texte &amp; Vorlagen</Link>.
          </p>
        </Card>
      )}

      <Card>
        <InvoiceForm
          action={saveInvoice.bind(null, slug, id)}
          locked={locked || !mayEdit}
          isEdit
          contacts={contacts.map((c) => ({ id: c.id, name: name(c), email: c.email, company: c.company }))}
          defaultTexts={{ intro: t.intro, outro: t.outro }}
          initial={{ kind, contactId: inv.contactId, issueDate: iso(inv.issueDate), dueDate: iso(inv.dueDate), buyerName: inv.buyerName ?? "", buyerAddress: inv.buyerAddress ?? "", buyerReference: inv.buyerReference ?? "", notes: inv.notes ?? "", items, buyerEmail: inv.buyerEmail ?? inv.contact?.email ?? "", serviceFrom: iso(inv.serviceFrom), serviceTo: iso(inv.serviceTo), taxExemptionReason: inv.taxExemptionReason ?? "", customerOrderRef: inv.customerOrderRef ?? "", introText: inv.introText ?? "", outroText: inv.outroText ?? "" }}
        />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { ScheduleMeetingButton } from "@/components/calendar/ScheduleMeetingButton";
import { ProcessCard } from "@/components/process/ProcessCard";
import { EnrichmentCard } from "@/components/enrich/EnrichmentCard";
import { MentionsCard } from "@/components/research/MentionsCard";
import { ContactConversations } from "@/components/inbox/ContactConversations";
import { ChannelConsent } from "@/components/messaging/ChannelConsent";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { Flash } from "@/components/b/Flash";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { ownerOptions } from "@/lib/objects/defaults";
import { contactName } from "@/lib/a-format";
import { Badge, btnCls, btnGhostCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { trustLevel, type TrustSignal } from "@/lib/trust";
import { addNote, deleteContact, updateContact } from "../actions";
import { ContactExtras } from "@/components/lists/ContactExtras";
import { SalesCard } from "@/components/objects/SalesCard";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  NOTE: "Notiz", EMAIL_OUT: "E-Mail gesendet", EMAIL_IN: "E-Mail erhalten", FORM: "Formular",
  DEAL: "Deal", TASK: "Aufgabe", SYSTEM: "System",
};

export default async function ContactDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const c = await db.contact.findFirst({
    where: { id, workspaceId: ws.id },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 100 },
      // Verknüpfte Datensätze nur im Rahmen der jeweiligen Rechte/Reichweite
      deals: { where: withScope({}, access, "deals"), include: { stage: true }, orderBy: { createdAt: "desc" } },
      tasks: { where: withScope({}, access, "tasks"), orderBy: [{ doneAt: "asc" }, { dueAt: "asc" }] },
      emails: { where: can(access, "email", "read") ? {} : { id: { in: [] } }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  // Außerhalb der Reichweite wie „nicht gefunden“ behandeln (verrät keine Existenz)
  if (!c || !can(access, "contacts", "read", c.ownerId)) notFound();
  const mayEdit = can(access, "contacts", "edit", c.ownerId);
  const mayDelete = can(access, "contacts", "delete", c.ownerId);
  const assignable = (await ownerOptions(ws.id))
    .filter((o) => canSetOwner(access.perms, "contacts", { userId: access.userId, teamUserIds: access.teamUserIds }, o.id))
    .map((o) => o.id);
  const trust = trustLevel(c.trustScore);
  const trustSignals = ((c.trustSignals as { signals?: TrustSignal[] } | null)?.signals ?? []).filter((x) => x.impact !== 0 || x.key === "via_agent");

  return (
    <div className="space-y-6">
      <PageHeader title={contactName(c)}>
        <Badge tone={trust.tone}>Echtheit: {trust.label}</Badge>
        <Link href={`/sa/${slug}/kontakte`} className={btnGhostCls}>Zurück</Link>
        {hasSpecial(access, "export") && (
          <a href={`/sa/${slug}/kontakte/${c.id}/auskunft`} className={btnGhostCls} title="Alle gespeicherten Daten dieses Kontakts als JSON (Art. 15/20 DSGVO)">
            Auskunft (DSGVO)
          </a>
        )}
        {mayDelete && (
          <form action={deleteContact.bind(null, slug, c.id)}>
            <button className={`${btnGhostCls} text-red-600`}>Löschen</button>
          </form>
        )}
        <ScheduleMeetingButton slug={slug} workspaceId={ws.id} contactIds={[c.id]} />
      </PageHeader>
      <Flash fehler={sp.fehler} />

      {trustSignals.length > 0 && (
        <p className="text-sm text-ink-600 dark:text-ink-200">
          <span className="font-medium">Echtheits-Signale: </span>
          {trustSignals.map((x) => `${x.label}${x.impact ? ` (${x.impact > 0 ? "+" : ""}${x.impact})` : ""}`).join(" · ")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Stammdaten" className="lg:col-span-1">
          <form action={updateContact.bind(null, slug, c.id)}>
            <fieldset disabled={!mayEdit} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input name="firstName" defaultValue={c.firstName ?? ""} placeholder="Vorname" className={inputCls} />
              <input name="lastName" defaultValue={c.lastName ?? ""} placeholder="Nachname" className={inputCls} />
            </div>
            <input name="email" type="email" defaultValue={c.email ?? ""} placeholder="E-Mail" className={inputCls} />
            <input name="phone" defaultValue={c.phone ?? ""} placeholder="Telefon" className={inputCls} />
            <input name="company" defaultValue={c.company ?? ""} placeholder="Firma" className={inputCls} />
            <input name="source" defaultValue={c.source ?? ""} placeholder="Quelle" className={inputCls} />
            <input name="tags" defaultValue={c.tags.join(", ")} placeholder="Tags" className={inputCls} />
            <textarea name="notes" defaultValue={c.notes ?? ""} placeholder="Interne Notiz" rows={3} className={inputCls} />
            {mayEdit && <button className={btnCls}>Speichern</button>}
            </fieldset>
          </form>
          <div className="mt-4 space-y-1 text-xs text-ink-400 dark:text-ink-200">
            <div>Angelegt: {formatDate(c.createdAt, true)}</div>
            <div>E-Mail-Einwilligung: {c.consentEmailAt ? `${formatDate(c.consentEmailAt, true)} (${c.consentSource ?? "ohne Quelle"})` : "keine"}</div>
            {c.unsubscribedAt && <div className="text-red-600">Abgemeldet: {formatDate(c.unsubscribedAt, true)}</div>}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <SalesCard slug={slug} workspaceId={ws.id} contact={c} canEdit={mayEdit} assignableOwnerIds={assignable} />
          <ContactExtras slug={slug} workspaceId={ws.id} contactId={c.id} attributes={c.attributes} canEdit={mayEdit} canEditLists={mayEdit && can(access, "lists", "edit")} />
          {mayEdit && (
            <Card title="Notiz hinzufügen">
              <form action={addNote.bind(null, slug, c.id)} className="space-y-2">
                <textarea name="body" required rows={2} className={inputCls} placeholder="Was ist passiert?" />
                <button className={btnCls}>Notiz speichern</button>
              </form>
            </Card>
          )}

          <Card title="Zeitleiste">
            {c.activities.length === 0 ? <Empty>Noch keine Aktivitäten.</Empty> : (
              <ol className="space-y-3 text-sm">
                {c.activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-black/10 pl-3 dark:border-white/10">
                    <div className="text-xs text-ink-400 dark:text-ink-200">{formatDate(a.createdAt, true)} · {TYPE_LABEL[a.type] ?? a.type}</div>
                    <div className="whitespace-pre-wrap">{a.body}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Deals">
              {c.deals.length === 0 ? <Empty>Keine Deals.</Empty> : (
                <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
                  {c.deals.map((d) => (
                    <li key={d.id} className="flex justify-between py-1.5">
                      <Link href={`/sa/${slug}/pipeline`} className="hover:underline">{d.title}</Link>
                      <span className="text-ink-400 dark:text-ink-200">{d.stage.name} · {formatEuro(d.valueCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Aufgaben">
              {c.tasks.length === 0 ? <Empty>Keine Aufgaben.</Empty> : (
                <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
                  {c.tasks.map((t) => (
                    <li key={t.id} className={`flex justify-between py-1.5 ${t.doneAt ? "text-ink-400 line-through" : ""}`}>
                      <span>{t.title}</span><span className="text-ink-400 dark:text-ink-200">{formatDate(t.dueAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="E-Mails">
            {c.emails.length === 0 ? <Empty>Keine E-Mails.</Empty> : (
              <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
                {c.emails.map((m) => (
                  <li key={m.id} className="py-1.5">
                    <div className="flex justify-between">
                      <span className="font-medium">{m.direction === "OUT" ? "→" : "←"} {m.subject}</span>
                      <span className="text-xs text-ink-400 dark:text-ink-200">{formatDate(m.createdAt, true)} · {m.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <ContactConversations slug={slug} workspaceId={ws.id} contactId={c.id} access={access} />
      <ChannelConsent slug={slug} workspaceId={ws.id} contactId={c.id} canEdit={mayEdit} />
      <EnrichmentCard slug={slug} workspaceId={ws.id} objectType="contact" objectId={c.id} canEdit={mayEdit} />
      <MentionsCard slug={slug} objectType="contact" objectId={c.id} />
      <ProcessCard slug={slug} workspaceId={ws.id} objectType="contact" objectId={c.id} access={access} />
    </div>
  );
}

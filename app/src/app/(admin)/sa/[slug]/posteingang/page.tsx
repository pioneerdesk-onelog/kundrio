import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Paperclip, Settings } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { contactName } from "@/lib/a-format";
import { getChannelAdapter } from "@/lib/inbox/channel";
import "@/lib/inbox/register";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/inbox/config";
import { withinFreeformWindow } from "@/lib/inbox/send";
import { Badge, btnCls, btnGhostCls, Empty, inputCls, PageHeader } from "@/components/ui";
import { ReplyBox } from "@/components/inbox/ReplyBox";
import { KeyboardNav, MarkRead, TicketButton } from "@/components/inbox/InboxClient";
import { MessageBody } from "@/components/inbox/MessageBody";
import { assignAction, draftAction, markReadAction, noteAction, replyAction, statusAction, tagsAction, toTicketAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { f?: string; s?: string; k?: string; q?: string; c?: string; bilder?: string; fehler?: string };

const FILTERS = { mine: "Mir zugewiesen", unassigned: "Nicht zugewiesen", all: "Alle" } as const;
const STATUS_FILTERS = { open: "Offen", pending: "Wartet auf Kunde", snoozed: "Zurückgestellt", closed: "Erledigt", alle: "Alle Status" } as const;

function href(slug: string, sp: SP, patch: Partial<SP>) {
  const next = { ...sp, fehler: undefined, ...patch };
  const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
  return `/sa/${slug}/posteingang${qs ? `?${qs}` : ""}`;
}

export default async function PosteingangPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, user, access } = await pageAccess(slug);
  const mayEdit = can(access, "email", "edit");
  const mayManage = hasSpecial(access, "manage_keys");

  const f = (sp.f && sp.f in FILTERS ? sp.f : "all") as keyof typeof FILTERS;
  const s = (sp.s && sp.s in STATUS_FILTERS ? sp.s : "open") as keyof typeof STATUS_FILTERS;
  const q = (sp.q ?? "").trim().slice(0, 100);

  const inboxes = await db.inbox.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, kind: true, address: true, status: true, lastError: true, active: true } });

  const where: Prisma.ConversationWhereInput = {
    workspaceId: ws.id,
    ...(s !== "alle" ? { status: s } : {}),
    ...(f === "mine" ? { assigneeId: user.id } : f === "unassigned" ? { assigneeId: null } : {}),
    ...(sp.k ? { inbox: { kind: sp.k } } : {}),
    ...(q
      ? {
          OR: [
            { subject: { contains: q, mode: "insensitive" } },
            { contact: { OR: [{ email: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }] } },
            { messages: { some: { bodyText: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [list, counts, owners] = await Promise.all([
    db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        inbox: { select: { kind: true, name: true } },
        assignee: { select: { name: true } },
        messages: { where: { direction: { in: ["in", "out"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { bodyText: true, direction: true } },
      },
    }),
    db.conversation.groupBy({ by: ["status"], where: { workspaceId: ws.id }, _count: true }),
    db.user.findMany({
      where: { active: true, OR: [{ memberships: { some: { workspaceId: ws.id } } }, { agencyRole: { in: ["owner", "admin"] } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const countOf = (st: string) => counts.find((c) => c.status === st)?._count ?? 0;

  const selectedId = sp.c && list.some((c) => c.id === sp.c) ? sp.c : (sp.c ?? list[0]?.id);
  const conv = selectedId
    ? await db.conversation.findFirst({
        where: { id: selectedId, workspaceId: ws.id },
        include: {
          inbox: true,
          assignee: { select: { id: true, name: true } },
          contact: { include: { companyRecord: { select: { id: true, name: true } } } },
          messages: { orderBy: { createdAt: "asc" }, take: 200 },
        },
      })
    : null;
  const senderIds = Array.from(new Set((conv?.messages ?? []).map((m) => m.sentById).filter(Boolean) as string[]));
  const senders = senderIds.length ? await db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } }) : [];
  const senderName = (id: string | null) => senders.find((u) => u.id === id)?.name ?? "Team";

  const contactVisible = conv?.contact ? can(access, "contacts", "read", conv.contact.ownerId) : false;
  const [deals, tickets, ticket] = await Promise.all([
    conv?.contactId && can(access, "deals", "read")
      ? db.deal.findMany({ where: withScope({ workspaceId: ws.id, contactId: conv.contactId }, access, "deals"), include: { stage: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 5 })
      : Promise.resolve([]),
    conv?.contactId && can(access, "tickets", "read")
      ? db.ticket.findMany({ where: withScope({ workspaceId: ws.id, contactId: conv.contactId }, access, "tickets"), include: { stage: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 5 })
      : Promise.resolve([]),
    conv?.ticketId ? db.ticket.findFirst({ where: { id: conv.ticketId, workspaceId: ws.id }, select: { id: true, numericId: true } }) : Promise.resolve(null),
  ]);

  const adapter = conv ? getChannelAdapter(conv.inbox.provider) : undefined;
  const lastIn = conv?.messages.filter((m) => m.direction === "in").at(-1);
  const windowOk = withinFreeformWindow(lastIn?.createdAt ?? null, adapter?.capabilities.freeformWindowHours);
  const hrefs = list.map((c) => href(slug, sp, { c: c.id, bilder: undefined }));
  const currentIndex = list.findIndex((c) => c.id === selectedId);

  return (
    <div>
      <PageHeader title="Posteingang" description="Alle Kanäle des Sub-Accounts an einem Ort. Kürzel: j/k wechseln, r antworten, e erledigt.">
        {mayManage && (
          <Link href={`/sa/${slug}/posteingang/einstellungen`} className={btnGhostCls}>
            <Settings size={16} aria-hidden /> Kanäle verwalten
          </Link>
        )}
      </PageHeader>
      <KeyboardNav hrefs={hrefs} currentIndex={currentIndex} />
      {sp.fehler && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-200">{sp.fehler.slice(0, 200)}</p>}

      {inboxes.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-8 text-center dark:border-white/10 dark:bg-ink-900">
          <p className="mb-3 text-ink-600 dark:text-ink-200">Noch kein Postfach verbunden.</p>
          {mayManage ? (
            <Link href={`/sa/${slug}/posteingang/einstellungen`} className={btnCls}>E-Mail-Postfach verbinden</Link>
          ) : (
            <p className="text-sm text-ink-400">Bitte eine Person mit dem Recht „API-, MCP- und Webhook-Zugänge verwalten“ bitten, ein Postfach zu verbinden.</p>
          )}
        </div>
      ) : (
        <>
          {inboxes.some((i) => i.status !== "ok") && (
            <p role="alert" className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              {inboxes.filter((i) => i.status !== "ok").map((i) => `${i.name}: ${i.status === "reconnect" ? "neu verbinden" : "Fehler"} ${i.lastError ? `(${i.lastError.slice(0, 120)})` : ""}`).join(" · ")}
            </p>
          )}
          <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
            {/* Liste */}
            <section aria-label="Gespräche" className="rounded-xl border border-ink-100 bg-white dark:border-white/10 dark:bg-ink-900">
              <form className="space-y-2 border-b border-ink-100 p-3 dark:border-white/10" action={`/sa/${slug}/posteingang`}>
                <input name="q" defaultValue={q} placeholder="Suchen …" className={inputCls} aria-label="Gespräche durchsuchen" />
                <input type="hidden" name="f" value={f} />
                <input type="hidden" name="s" value={s} />
                {sp.k && <input type="hidden" name="k" value={sp.k} />}
              </form>
              <nav aria-label="Filter" className="flex flex-wrap gap-1 border-b border-ink-100 p-2 text-sm dark:border-white/10">
                {Object.entries(FILTERS).map(([k, label]) => (
                  <Link key={k} href={href(slug, sp, { f: k, c: undefined })} aria-current={f === k ? "true" : undefined} className={`rounded-md px-2 py-1 ${f === k ? "bg-accent-50 font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-100" : "hover:bg-sand-100 dark:hover:bg-white/10"}`}>
                    {label}
                  </Link>
                ))}
              </nav>
              <nav aria-label="Status" className="flex flex-wrap gap-1 border-b border-ink-100 p-2 text-sm dark:border-white/10">
                {Object.entries(STATUS_FILTERS).map(([k, label]) => (
                  <Link key={k} href={href(slug, sp, { s: k, c: undefined })} aria-current={s === k ? "true" : undefined} className={`rounded-md px-2 py-1 ${s === k ? "bg-accent-50 font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-100" : "hover:bg-sand-100 dark:hover:bg-white/10"}`}>
                    {label}
                    {k !== "alle" && ` (${countOf(k)})`}
                  </Link>
                ))}
                {Array.from(new Set(inboxes.map((i) => i.kind))).length > 1 &&
                  Array.from(new Set(inboxes.map((i) => i.kind))).map((k) => (
                    <Link key={k} href={href(slug, sp, { k: sp.k === k ? undefined : k, c: undefined })} className={`rounded-md px-2 py-1 ${sp.k === k ? "bg-accent-50 font-semibold" : "hover:bg-sand-100 dark:hover:bg-white/10"}`}>
                      {KIND_LABELS[k] ?? k}
                    </Link>
                  ))}
              </nav>
              {list.length === 0 ? (
                <Empty>Keine Gespräche in dieser Ansicht.</Empty>
              ) : (
                <ul className="max-h-[70vh] divide-y divide-ink-100 overflow-y-auto dark:divide-white/10">
                  {list.map((c) => {
                    const who = c.contact ? contactName(c.contact) : c.messages[0] ? "Unbekannt" : "–";
                    return (
                      <li key={c.id}>
                        <Link
                          href={href(slug, sp, { c: c.id, bilder: undefined })}
                          aria-current={c.id === selectedId ? "true" : undefined}
                          className={`block px-3 py-2.5 ${c.id === selectedId ? "bg-accent-50 dark:bg-accent-500/15" : "hover:bg-sand-100 dark:hover:bg-white/5"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`truncate ${c.unread > 0 ? "font-semibold text-ink-900 dark:text-ink-50" : "text-ink-800 dark:text-ink-100"}`}>{who}</span>
                            <span className="shrink-0 text-xs text-ink-400">{formatDate(c.lastMessageAt)}</span>
                          </div>
                          <div className="truncate text-sm text-ink-600 dark:text-ink-200">{c.subject || "(ohne Betreff)"}</div>
                          <div className="truncate text-xs text-ink-400">{c.messages[0]?.direction === "out" ? "Sie: " : ""}{c.messages[0]?.bodyText.slice(0, 120)}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge>{KIND_LABELS[c.inbox.kind] ?? c.inbox.kind}</Badge>
                            {c.unread > 0 && <Badge tone="accent">{c.unread} neu</Badge>}
                            {c.assignee && <Badge>{c.assignee.name}</Badge>}
                            {c.tags.slice(0, 2).map((t) => <Badge key={t} tone={t === "spam" ? "bad" : "neutral"}>{t}</Badge>)}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Gespräch */}
            <section aria-label="Gespräch" className="min-w-0 space-y-4">
              {!conv ? (
                <div className="rounded-xl border border-ink-100 bg-white p-8 dark:border-white/10 dark:bg-ink-900"><Empty>Gespräch auswählen.</Empty></div>
              ) : (
                <>
                  {conv.unread > 0 && <MarkRead action={markReadAction.bind(null, slug, conv.id)} />}
                  <div className="rounded-xl border border-ink-100 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-display text-xl text-ink-900 dark:text-ink-50">{conv.subject || "(ohne Betreff)"}</h2>
                        <p className="text-sm text-ink-400 dark:text-ink-200">
                          {conv.inbox.name} · {STATUS_LABELS[conv.status] ?? conv.status}
                          {conv.snoozedUntil && ` bis ${formatDate(conv.snoozedUntil, true)}`}
                        </p>
                      </div>
                      {mayEdit && (
                        <div className="flex flex-wrap gap-2">
                          <form action={statusAction.bind(null, slug, conv.id)}>
                            <input type="hidden" name="status" value="closed" />
                            <button id="pd-close-conversation" className={btnGhostCls} disabled={conv.status === "closed"}>Erledigt (e)</button>
                          </form>
                          <form action={statusAction.bind(null, slug, conv.id)}>
                            <input type="hidden" name="status" value={conv.status === "open" ? "pending" : "open"} />
                            <button className={btnGhostCls}>{conv.status === "open" ? "Wartet auf Kunde" : "Wieder öffnen"}</button>
                          </form>
                          <form action={statusAction.bind(null, slug, conv.id)} className="flex items-center gap-1">
                            <input type="hidden" name="status" value="snoozed" />
                            <select name="snoozeHours" aria-label="Zurückstellen für" className={`${inputCls} w-auto py-1.5`} defaultValue="24">
                              <option value="4">4 Std.</option>
                              <option value="24">1 Tag</option>
                              <option value="72">3 Tage</option>
                              <option value="168">1 Woche</option>
                            </select>
                            <button className={btnGhostCls}>Zurückstellen</button>
                          </form>
                          {can(access, "tickets", "edit") && <TicketButton action={toTicketAction.bind(null, slug, conv.id)} existing={ticket ? `#${ticket.numericId}` : undefined} />}
                        </div>
                      )}
                    </div>
                  </div>

                  <ol className="space-y-3" aria-label="Verlauf">
                    {conv.messages.map((m) => {
                      const atts = (Array.isArray(m.attachments) ? m.attachments : []) as { fileId?: string; name: string; size: number; skipped?: string }[];
                      return (
                        <li
                          key={m.id}
                          className={`rounded-xl border p-4 ${
                            m.direction === "note"
                              ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                              : m.direction === "out"
                                ? "border-accent-100 bg-accent-50/50 dark:border-accent-500/30 dark:bg-accent-500/10"
                                : "border-ink-100 bg-white dark:border-white/10 dark:bg-ink-900"
                          }`}
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-ink-900 dark:text-ink-50">
                              {m.direction === "note" ? `Interne Notiz · ${senderName(m.sentById)}` : m.direction === "out" ? `${senderName(m.sentById)} an ${m.toAddrs.join(", ")}` : m.fromAddr}
                            </span>
                            <span className="text-ink-400">
                              {formatDate(m.createdAt, true)}
                              {m.direction === "out" && m.status !== "sent" && <> · <Badge tone={m.status === "failed" ? "bad" : m.status === "captured" ? "warn" : "neutral"}>{m.status === "failed" ? "fehlgeschlagen" : m.status === "captured" ? "Testmodus – nicht versendet" : m.status}</Badge></>}
                            </span>
                          </div>
                          {m.error && <p className="mb-2 text-sm text-red-700 dark:text-red-300">{m.error}</p>}
                          <MessageBody text={m.bodyText} html={m.direction === "in" ? m.bodyHtml : null} showImages={sp.bilder === m.id} imagesHref={href(slug, sp, { bilder: m.id })} />
                          {atts.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                              {atts.map((a, i) => (
                                <li key={i}>
                                  {a.fileId ? (
                                    <a className="inline-flex items-center gap-1 underline" href={`/sa/${slug}/posteingang/datei/${a.fileId}`}>
                                      <Paperclip size={14} aria-hidden /> {a.name}
                                    </a>
                                  ) : (
                                    <span className="text-ink-400" title={a.skipped}>
                                      <Paperclip size={14} aria-hidden className="inline" /> {a.name} (nicht gespeichert)
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ol>

                  {mayEdit ? (
                    <ReplyBox
                      reply={replyAction.bind(null, slug, conv.id)}
                      note={noteAction.bind(null, slug, conv.id)}
                      draft={draftAction.bind(null, slug, conv.id)}
                      channelLabel={KIND_LABELS[conv.inbox.kind] ?? conv.inbox.kind}
                      subject={Boolean(adapter?.capabilities.subject)}
                      attachments={Boolean(adapter?.capabilities.attachments)}
                      hint={!adapter ? "Für diesen Kanal ist kein Adapter eingerichtet – Senden nicht möglich." : !windowOk ? `Das ${adapter.capabilities.freeformWindowHours}-Stunden-Fenster ist abgelaufen: Freitext ist nicht möglich, bitte eine freigegebene Vorlage nutzen.` : undefined}
                    />
                  ) : (
                    <p className="text-sm text-ink-400">Sie können dieses Gespräch nur lesen.</p>
                  )}
                </>
              )}
            </section>

            {/* Kontext */}
            <aside aria-label="Kontext" className="space-y-4">
              {conv && (
                <>
                  <div className="rounded-xl border border-ink-100 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
                    <h3 className="mb-2 text-sm font-semibold">Kontakt</h3>
                    {conv.contact && contactVisible ? (
                      <div className="space-y-1 text-sm">
                        <Link className="font-medium hover:underline" href={`/sa/${slug}/kontakte/${conv.contact.id}`}>{contactName(conv.contact)}</Link>
                        {conv.contact.email && <div className="text-ink-600 dark:text-ink-200">{conv.contact.email}</div>}
                        {conv.contact.phone && <div className="text-ink-600 dark:text-ink-200">{conv.contact.phone}</div>}
                        {conv.contact.companyRecord && (
                          <Link className="block hover:underline" href={`/sa/${slug}/unternehmen/${conv.contact.companyRecord.id}`}>{conv.contact.companyRecord.name}</Link>
                        )}
                        <Badge>{conv.contact.lifecycleStage}</Badge>
                      </div>
                    ) : conv.contact ? (
                      <p className="text-sm text-ink-400">Kontakt außerhalb Ihrer Reichweite.</p>
                    ) : (
                      <p className="text-sm text-ink-400">Kein Kontakt zugeordnet.</p>
                    )}
                  </div>
                  {mayEdit && (
                    <div className="space-y-3 rounded-xl border border-ink-100 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
                      <form action={assignAction.bind(null, slug, conv.id)} className="space-y-1">
                        <label className="text-sm font-semibold" htmlFor="pd-assignee">Zuständig</label>
                        <div className="flex gap-2">
                          <select id="pd-assignee" name="assigneeId" defaultValue={conv.assigneeId ?? ""} className={inputCls}>
                            <option value="">– niemand –</option>
                            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                          <button className={btnGhostCls}>OK</button>
                        </div>
                      </form>
                      <form action={tagsAction.bind(null, slug, conv.id)} className="space-y-1">
                        <label className="text-sm font-semibold" htmlFor="pd-tags">Tags</label>
                        <div className="flex gap-2">
                          <input id="pd-tags" name="tags" defaultValue={conv.tags.join(", ")} className={inputCls} placeholder="z. B. angebot, dringend" />
                          <button className={btnGhostCls}>OK</button>
                        </div>
                      </form>
                    </div>
                  )}
                  {deals.length > 0 && (
                    <div className="rounded-xl border border-ink-100 bg-white p-4 text-sm dark:border-white/10 dark:bg-ink-900">
                      <h3 className="mb-2 font-semibold">Deals</h3>
                      <ul className="space-y-1">
                        {deals.map((d) => (
                          <li key={d.id}><Link className="hover:underline" href={`/sa/${slug}/pipeline/${d.id}`}>{d.title}</Link> · {d.stage.name} · {formatEuro(d.valueCents)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {tickets.length > 0 && (
                    <div className="rounded-xl border border-ink-100 bg-white p-4 text-sm dark:border-white/10 dark:bg-ink-900">
                      <h3 className="mb-2 font-semibold">Tickets</h3>
                      <ul className="space-y-1">
                        {tickets.map((t) => (
                          <li key={t.id}><Link className="hover:underline" href={`/sa/${slug}/tickets/${t.id}`}>#{t.numericId} {t.subject}</Link> · {t.stage.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

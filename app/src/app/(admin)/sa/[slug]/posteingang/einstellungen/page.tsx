import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { guardOrRedirect } from "@/lib/permissions/guard";
import { KIND_LABELS, parseInboxConfig } from "@/lib/inbox/config";
import { credentialSummary } from "@/lib/inbox/credentials";
import { Badge, btnGhostCls, Card, PageHeader } from "@/components/ui";
import { EmailInboxForm, TestButton } from "./forms";
import { pollNowAction, saveEmailInboxAction, testInboxAction, toggleInboxAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PosteingangEinstellungen({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ bearbeiten?: string }> }) {
  const { slug } = await params;
  const { bearbeiten } = await searchParams;
  const { ws } = await guardOrRedirect(slug, { special: "manage_keys" }, `/sa/${slug}/posteingang`);
  const [inboxes, users] = await Promise.all([
    db.inbox.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { conversations: true } } } }),
    db.user.findMany({
      where: { active: true, OR: [{ memberships: { some: { workspaceId: ws.id } } }, { agencyRole: { in: ["owner", "admin"] } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const editing = bearbeiten ? inboxes.find((i) => i.id === bearbeiten && i.kind === "email") : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Posteingang – Kanäle" description="Postfächer und Messenger, deren Nachrichten im gemeinsamen Posteingang landen.">
        <Link href={`/sa/${slug}/posteingang`} className={btnGhostCls}>Zurück zum Posteingang</Link>
      </PageHeader>

      <Card title="Verbundene Kanäle">
        {inboxes.length === 0 ? (
          <p className="text-sm text-ink-400">Noch keine Kanäle verbunden.</p>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {inboxes.map((i) => {
              const fields = credentialSummary(i);
              return (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="space-y-1">
                    <div className="font-medium">{i.name} <span className="text-ink-400">· {i.address}</span></div>
                    <div className="flex flex-wrap gap-1 text-sm">
                      <Badge>{KIND_LABELS[i.kind] ?? i.kind}</Badge>
                      <Badge tone={!i.active ? "neutral" : i.status === "ok" ? "ok" : i.status === "reconnect" ? "warn" : "bad"}>
                        {!i.active ? "pausiert" : i.status === "ok" ? "verbunden" : i.status === "reconnect" ? "neu verbinden" : "Fehler"}
                      </Badge>
                      <Badge>{i._count.conversations} Gespräche</Badge>
                      {fields.length > 0 && <Badge>Zugangsdaten hinterlegt</Badge>}
                    </div>
                    <div className="text-xs text-ink-400">
                      Letzter Abruf: {i.lastSyncAt ? formatDate(i.lastSyncAt, true) : "noch nie"}
                      {i.lastError && <> · <span className="text-red-700 dark:text-red-300">{i.lastError.slice(0, 200)}</span></>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {i.kind === "email" ? (
                      <Link href={`/sa/${slug}/posteingang/einstellungen?bearbeiten=${i.id}`} className={btnGhostCls}>Bearbeiten</Link>
                    ) : (
                      <Link href={`/sa/${slug}/posteingang/kanaele`} className={btnGhostCls}>Verwalten</Link>
                    )}
                    <TestButton action={testInboxAction.bind(null, slug, i.id)} />
                    <form action={pollNowAction.bind(null, slug, i.id)}><button className={btnGhostCls} disabled={!i.active}>Jetzt abrufen</button></form>
                    <form action={toggleInboxAction.bind(null, slug, i.id)}><button className={btnGhostCls}>{i.active ? "Pausieren" : "Aktivieren"}</button></form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-400 dark:text-ink-200">
          WhatsApp und SMS verbinden: <Link className="underline" href={`/sa/${slug}/posteingang/kanaele`}>Messenger-Kanäle</Link>.
        </p>
      </Card>

      <Card title={editing ? `Postfach „${editing.name}“ bearbeiten` : "E-Mail-Postfach verbinden (IMAP/SMTP)"}>
        <EmailInboxForm
          key={editing?.id ?? "neu"}
          action={saveEmailInboxAction.bind(null, slug, editing?.id ?? null)}
          initial={editing ? { name: editing.name, address: editing.address, config: parseInboxConfig(editing.config), hasPassword: credentialSummary(editing).length > 0 } : null}
          users={users}
        />
        {editing && <p className="mt-3 text-sm"><Link className="underline" href={`/sa/${slug}/posteingang/einstellungen`}>Stattdessen neues Postfach verbinden</Link></p>}
      </Card>
    </div>
  );
}

import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can, type Access } from "@/lib/permissions";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/inbox/config";
import { Badge, Card } from "@/components/ui";

/**
 * Gespräche eines Kontakts (Server-Komponente) – für die Kontakt-Detailseite.
 * Einbau: <ContactConversations slug={slug} workspaceId={ws.id} contactId={c.id} access={access} />
 */
export async function ContactConversations({ slug, workspaceId, contactId, access }: { slug: string; workspaceId: string; contactId: string; access: Access }) {
  if (!can(access, "email", "read")) return null;
  const list = await db.conversation.findMany({
    where: { workspaceId, contactId },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    include: { inbox: { select: { kind: true, name: true } }, _count: { select: { messages: true } } },
  });
  return (
    <Card title="Gespräche">
      {list.length === 0 ? (
        <p className="text-sm text-ink-400">Noch keine Gespräche im Posteingang.</p>
      ) : (
        <ul className="divide-y divide-ink-100 text-sm dark:divide-white/10">
          {list.map((c) => (
            <li key={c.id} className="py-2">
              <Link className="font-medium hover:underline" href={`/sa/${slug}/posteingang?c=${c.id}&s=alle`}>{c.subject || "(ohne Betreff)"}</Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-ink-400">
                <Badge>{KIND_LABELS[c.inbox.kind] ?? c.inbox.kind}</Badge>
                <Badge tone={c.status === "open" ? "accent" : "neutral"}>{STATUS_LABELS[c.status] ?? c.status}</Badge>
                {c.unread > 0 && <Badge tone="warn">{c.unread} neu</Badge>}
                <span>{c._count.messages} Nachrichten · {formatDate(c.lastMessageAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

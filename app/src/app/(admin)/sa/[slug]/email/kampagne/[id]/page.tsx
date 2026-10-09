import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { campaignAudience } from "@/lib/mail";
import { formatDate, formatNumber } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { btnCls, btnGhostCls, Card, Empty, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { approveCampaign, deleteCampaign, saveCampaign, sendCampaignNow } from "../../actions";
import { CampaignForm } from "../CampaignForm";
import { listOptions } from "@/lib/lists";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: FlashParams }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "email", "edit");
  const mayApprove = hasSpecial(access, "approve");
  const maySend = hasSpecial(access, "send_campaigns");
  const c = await db.campaign.findFirst({
    where: { id, workspaceId: ws.id },
    include: { recipients: { include: { contact: { select: { email: true } } }, orderBy: { sentAt: "desc" }, take: 500 } },
  });
  if (!c) notFound();

  const tags = (c.audience as { tags?: string[] } | null)?.tags ?? [];
  const listIds = (c.audience as { listIds?: string[] } | null)?.listIds ?? [];
  const lists = await listOptions(ws.id);
  const editable = c.status === "DRAFT" || c.status === "APPROVED";
  const audience = editable ? await campaignAudience(ws.id, c.audience) : [];
  const n = audience.length;
  // Zielgruppe für die Freigabe verständlich benennen: Tags und/oder Listen (ODER-verknüpft)
  const listNames = lists.filter((l) => listIds.includes(l.id)).map((l) => l.name);
  const audienceLabel = [
    tags.length ? `Tags ${tags.join(", ")}` : null,
    listNames.length ? `Listen ${listNames.join(", ")}` : null,
  ].filter(Boolean).join(" oder ") || "alle Kontakte";

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={c.name}>
        <Link href={`/sa/${slug}/email`} className={btnGhostCls}>Zurück</Link>
      </PageHeader>
      <Flash {...await searchParams} />

      <Card title="1 · Inhalt">
        {c.status === "APPROVED" && (
          <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">Speichern hebt die Freigabe auf.</p>
        )}
        <CampaignForm
          action={saveCampaign.bind(null, slug, c.id)}
          locked={!editable || !mayEdit}
          values={{ name: c.name, subject: c.subject, bodyMarkdown: c.bodyMarkdown, tags: tags.join(", "), listIds }}
          lists={lists}
        />
      </Card>

      {editable && (
        <Card title="2 · Vorschau & Freigabe">
          <p className="text-sm">
            Zielgruppe: {audienceLabel} – nur mit Einwilligung, nicht abgemeldet →{" "}
            <strong>{formatNumber(n)} Empfänger</strong>
          </p>
          {audience.length > 0 && (
            <p className="mt-1 text-xs text-ink-400 dark:text-ink-200">
              {audience.slice(0, 5).map((a) => a.email).join(", ")}
              {n > 5 && ` … und ${n - 5} weitere`}
            </p>
          )}
          {c.status === "DRAFT" && !mayApprove ? (
            <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">Die Freigabe erteilt jemand mit dem Recht „Freigaben erteilen“.</p>
          ) : c.status === "DRAFT" ? (
            <form action={approveCampaign.bind(null, slug, c.id)} className="mt-4 space-y-3">
              <input type="hidden" name="expected" value={n} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirm" required disabled={n === 0} />
                Ich gebe den Versand an {formatNumber(n)} Empfänger frei.
              </label>
              <button className={btnCls} disabled={n === 0}>Freigeben</button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-green-700 dark:text-green-300">
              Freigegeben von {c.approvedBy} am {formatDate(c.approvedAt, true)}.
            </p>
          )}
        </Card>
      )}

      {c.status === "APPROVED" && maySend && (
        <Card title="3 · Versand">
          <form action={sendCampaignNow.bind(null, slug, c.id)}>
            <button className={btnCls}>Jetzt an {formatNumber(n)} Empfänger senden</button>
          </form>
        </Card>
      )}

      {c.recipients.length > 0 && (
        <Card title={`Empfänger (${c.recipients.length})`}>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-400 dark:text-ink-200"><tr><th className="py-1">E-Mail</th><th>Status</th><th>Gesendet</th><th>Fehler</th></tr></thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {c.recipients.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5">{r.contact.email}</td>
                  <td>{r.status}</td>
                  <td className="text-ink-400 dark:text-ink-200">{formatDate(r.sentAt, true)}</td>
                  <td className="text-xs text-red-600">{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {c.recipients.length === 0 && !editable && <Empty>Keine Empfänger.</Empty>}

      {editable && can(access, "email", "delete") && (
        <form action={deleteCampaign.bind(null, slug, c.id)}>
          <button className="text-sm text-red-600 hover:underline">Kampagne löschen</button>
        </form>
      )}
    </div>
  );
}

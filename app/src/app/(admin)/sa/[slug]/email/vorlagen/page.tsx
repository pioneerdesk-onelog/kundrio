import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { Badge, Card, Empty, PageHeader, btnGhostCls } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { TemplateForm } from "@/components/mail/TemplateForm";
import { saveTemplate } from "./actions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const flash = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const templates = await db.emailTemplate.findMany({ where: { workspaceId: ws.id }, orderBy: { numericId: "asc" } });

  return (
    <div className="space-y-6">
      <PageHeader title="E-Mail-Vorlagen" description="Vorlagen für Transaktionsmails. Produkte nutzen sie per templateId über die Brevo-kompatible Schnittstelle.">
        <Link href={`/sa/${slug}/email`} className={btnGhostCls}>Zurück zu E-Mail</Link>
        <Link href={`/sa/${slug}/api`} className={btnGhostCls}>API & Schnittstellen</Link>
      </PageHeader>
      <Flash {...flash} />

      <Card title="Vorhandene Vorlagen">
        {templates.length === 0 ? (
          <Empty>Noch keine Vorlagen.</Empty>
        ) : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400 dark:text-ink-200">
              <tr><th className="py-2 pr-3">templateId</th><th className="pr-3">Name</th><th className="pr-3">Betreff</th><th className="pr-3">Status</th><th>Geändert</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 pr-3 font-mono">{t.numericId}</td>
                  <td className="pr-3"><Link className="font-medium text-accent-500 hover:underline dark:text-accent-100" href={`/sa/${slug}/email/vorlagen/${t.id}`}>{t.name}</Link></td>
                  <td className="pr-3">{t.subject}</td>
                  <td className="pr-3"><Badge tone={t.isActive ? "ok" : "neutral"}>{t.isActive ? "aktiv" : "inaktiv"}</Badge>{t.source && <span className="ml-2 text-xs text-ink-400">{t.source}</span>}</td>
                  <td>{formatDate(t.updatedAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {can(access, "email", "edit") && (
        <Card title="Neue Vorlage">
          <TemplateForm action={saveTemplate.bind(null, slug, null)} />
        </Card>
      )}
    </div>
  );
}

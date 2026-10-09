import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { parseFields } from "@/lib/b-forms";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { btnGhostCls, Card, Empty, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { FormBuilder } from "@/components/b/FormBuilder";
import { deleteForm, saveForm } from "../actions";

export const dynamic = "force-dynamic";

export default async function FormDetail({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: FlashParams }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  const form = await db.form.findFirst({
    where: { id, workspaceId: ws.id },
    include: { submissions: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!form) notFound();
  const fields = parseFields(form.fields);
  const publicUrl = `${env.appUrl()}/f/${form.id}`;
  const snippet = `<iframe src="${publicUrl}" style="width:100%;min-height:520px;border:0" title="${form.name.replace(/"/g, "")}"></iframe>`;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title={form.name}>
        <a href={`/f/${form.id}`} target="_blank" rel="noreferrer" className={btnGhostCls}>Öffentliche Seite</a>
        <Link href={`/sa/${slug}/formulare`} className={btnGhostCls}>Zurück</Link>
      </PageHeader>
      <Flash {...await searchParams} />

      <Card title="Einbetten">
        <p className="mb-2 text-sm">Link: <code className="text-xs">{publicUrl}</code></p>
        <textarea readOnly rows={3} aria-label="Einbettungscode" className="w-full rounded-md border border-black/15 bg-sand-100 p-2 font-mono text-xs dark:border-white/15 dark:bg-ink-900" value={snippet} />
      </Card>

      {can(access, "forms", "edit") && <Card title="Bearbeiten">
        <FormBuilder
          action={saveForm.bind(null, slug, form.id)}
          initial={{ name: form.name, fields, consentText: form.consentText ?? "" }}
        />
      </Card>}

      <Card title={`Einsendungen (${form.submissions.length})`}>
        {form.submissions.length === 0 ? <Empty>Noch keine Einsendungen.</Empty> : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
            {form.submissions.map((s) => (
              <li key={s.id} className="py-1.5">
                <span className="text-ink-400 dark:text-ink-200">{formatDate(s.createdAt, true)} · </span>
                {s.contactId ? <Link className="hover:underline" href={`/sa/${slug}/kontakte/${s.contactId}`}>Kontakt</Link> : "ohne Kontakt"}
                <span className="ml-2 text-xs text-ink-400 dark:text-ink-200">
                  {Object.entries((s.data ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(" · ").slice(0, 200)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can(access, "forms", "delete") && (
        <form action={deleteForm.bind(null, slug, form.id)}>
          <button className="text-sm text-red-600 hover:underline">Formular löschen</button>
        </form>
      )}
    </div>
  );
}

import Link from "next/link";
import { plural } from "@/lib/a-format";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { Card, Empty, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { FormBuilder } from "@/components/b/FormBuilder";
import { saveForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function FormsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const forms = await db.form.findMany({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { submissions: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Formulare" />
      <Flash {...await searchParams} />
      <Card title="Vorhandene Formulare">
        {forms.length === 0 ? <Empty>Noch keine Formulare.</Empty> : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
            {forms.map((f) => (
              <li key={f.id} className="flex justify-between py-1.5">
                <Link className="hover:underline" href={`/sa/${slug}/formulare/${f.id}`}>{f.name}</Link>
                <span className="text-xs text-ink-400 dark:text-ink-200">
                  {plural(f._count.submissions, "Einsendung", "Einsendungen")} · {f.consentText ? "mit DOI" : "ohne Einwilligung"} · {formatDate(f.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can(access, "forms", "edit") && (
        <Card title="Neues Formular">
          <FormBuilder action={saveForm.bind(null, slug, null)} />
        </Card>
      )}
    </div>
  );
}

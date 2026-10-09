import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { Card, Empty, PageHeader } from "@/components/ui";
import { NewPageForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function WikiIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const pages = await db.wikiPage.findMany({
    where: { workspaceId: ws.id },
    orderBy: { title: "asc" },
    include: { _count: { select: { revisions: { where: { status: "proposed" } } } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Wiki" />
      <Card>
        <p className="mb-3 text-sm text-ink-400 dark:text-ink-200">
          Das Wiki sammelt das verdichtete Wissen über {ws.name}. Das lokale Modell schlägt Überarbeitungen aus der Wissensbasis
          vor. Übernommen wird nur, was ein Mensch freigibt.
        </p>
        {can(access, "knowledge", "edit") && <NewPageForm slug={slug} />}
      </Card>
      <Card title={`Seiten (${pages.length})`}>
        {pages.length === 0 ? <Empty>Noch keine Seiten.</Empty> : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
            {pages.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <Link href={`/sa/${slug}/wiki/${p.slug}`} className="font-medium hover:underline">{p.title}</Link>
                <span className="text-xs text-ink-400 dark:text-ink-200">
                  {p._count.revisions > 0 && (
                    <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {p._count.revisions} Vorschlag{p._count.revisions > 1 ? "e" : ""}
                    </span>
                  )}
                  geändert {formatDate(p.updatedAt, true)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess, withScope } from "@/lib/permissions/guard";
import { contactName } from "@/lib/a-format";
import { Badge, btnCls, btnGhostCls, Card, Empty, inputCls, PageHeader } from "@/components/ui";
import { trustLevel } from "@/lib/trust";
import { ImportForm } from "@/components/a/ImportForm";
import { createContact, importCsv } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string; tag?: string }>;
}) {
  const { slug } = await params;
  const { q = "", tag = "" } = await searchParams;
  const { ws, access } = await pageAccess(slug);
  const mayCreate = can(access, "contacts", "edit");

  const query = q.trim().slice(0, 100);
  const where: Prisma.ContactWhereInput = { workspaceId: ws.id };
  if (query) {
    where.OR = ["firstName", "lastName", "email", "company", "phone"].map((f) => ({
      [f]: { contains: query, mode: "insensitive" },
    }));
  }
  if (tag) where.tags = { has: tag };

  const [contacts, total, tagRows] = await Promise.all([
    db.contact.findMany({ where: withScope(where, access, "contacts"), orderBy: { createdAt: "desc" }, take: 200 }),
    db.contact.count({ where: withScope(where, access, "contacts") }),
    db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), select: { tags: true } }),
  ]);
  const allTags = Array.from(new Set(tagRows.flatMap((r) => r.tags))).sort();

  return (
    <div className="space-y-6">
      <PageHeader title={`Kontakte (${formatNumber(total)})`}>
        {hasSpecial(access, "export") && <a href={`/sa/${slug}/kontakte/export`} className={btnGhostCls}>CSV-Export</a>}
      </PageHeader>

      <form className="flex flex-wrap gap-2">
        <input name="q" aria-label="Kontakte suchen" defaultValue={query} placeholder="Name, E-Mail, Firma, Telefon…" className={`${inputCls} max-w-sm`} />
        <select name="tag" aria-label="Nach Tag filtern" defaultValue={tag} className={`${inputCls} max-w-48`}>
          <option value="">Alle Tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className={btnGhostCls}>Filtern</button>
        {(query || tag) && <Link href={`/sa/${slug}/kontakte`} className={btnGhostCls}>Zurücksetzen</Link>}
      </form>

      <Card>
        {contacts.length === 0 ? (
          <Empty>Keine Kontakte gefunden.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_td]:pr-3 [&_th]:pr-3">
              <thead className="text-left text-xs text-ink-400 dark:text-ink-200">
                <tr><th className="py-2">Name</th><th>E-Mail</th><th>Firma</th><th>Tags</th><th>Einwilligung</th><th>Echtheit</th><th>Angelegt</th></tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2"><Link className="font-medium hover:underline" href={`/sa/${slug}/kontakte/${c.id}`}>{contactName(c)}</Link></td>
                    <td>{c.email ?? "–"}</td>
                    <td>{c.company ?? "–"}</td>
                    <td className="space-x-1">
                      {c.tags.map((t) => (
                        <Link key={t} href={`/sa/${slug}/kontakte?tag=${encodeURIComponent(t)}`} className="inline-block whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">{t}</Link>
                      ))}
                    </td>
                    <td className="text-xs">{c.unsubscribedAt ? "abgemeldet" : c.consentEmailAt ? "ja" : "–"}</td>
                    <td>{(() => { const t = trustLevel(c.trustScore); return <Badge tone={t.tone}>{t.label}</Badge>; })()}</td>
                    <td className="text-ink-400 dark:text-ink-200">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > contacts.length && <p className="pt-2 text-xs text-ink-400 dark:text-ink-200">Zeige {formatNumber(contacts.length)} von {formatNumber(total)}. Suche verfeinern.</p>}
          </div>
        )}
      </Card>

      {(mayCreate || hasSpecial(access, "import")) && (
      <div className="grid gap-4 md:grid-cols-2">
        {mayCreate && (
        <Card title="Kontakt anlegen">
          <form action={createContact.bind(null, slug)} className="grid grid-cols-2 gap-2">
            <input name="firstName" placeholder="Vorname" className={inputCls} />
            <input name="lastName" placeholder="Nachname" className={inputCls} />
            <input name="email" type="email" placeholder="E-Mail" className={`${inputCls} col-span-2`} />
            <input name="phone" placeholder="Telefon" className={inputCls} />
            <input name="company" placeholder="Firma" className={inputCls} />
            <input name="tags" placeholder="Tags, mit Komma getrennt" className={`${inputCls} col-span-2`} />
            <div className="col-span-2"><button className={btnCls}>Anlegen</button></div>
          </form>
        </Card>
        )}
        {hasSpecial(access, "import") && (
        <Card title="CSV-Import">
          <ImportForm action={importCsv.bind(null, slug)} />
        </Card>
        )}
      </div>
      )}
    </div>
  );
}

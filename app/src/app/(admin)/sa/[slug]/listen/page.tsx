import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/workspace";
import { can } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { listProperties, parseOptions } from "@/lib/properties";
import { Badge, btnCls, btnGhostCls, Card, Empty, inputCls, labelCls, PageHeader } from "@/components/ui";
import { Flash, type FlashParams } from "@/components/b/Flash";
import { createList, deleteProperty, saveProperty } from "./actions";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { text: "Text", number: "Zahl", date: "Datum", boolean: "Ja/Nein", select: "Auswahl" };

function PropertyForm({ action, value }: { action: (fd: FormData) => Promise<void>; value?: { key: string; label: string; type: string; options: string } }) {
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_10rem] sm:items-end">
      <label>
        <span className={labelCls}>Schlüssel</span>
        <input name="key" required maxLength={50} defaultValue={value?.key} readOnly={!!value} className={`${inputCls} font-mono uppercase`} placeholder="TENANT_ID" />
      </label>
      <label>
        <span className={labelCls}>Bezeichnung</span>
        <input name="label" required maxLength={120} defaultValue={value?.label} className={inputCls} placeholder="Mandanten-ID" />
      </label>
      <label>
        <span className={labelCls}>Typ</span>
        <select name="type" defaultValue={value?.type ?? "text"} className={inputCls}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="sm:col-span-3">
        <span className={labelCls}>Optionen (nur bei Auswahl; eine pro Zeile)</span>
        <textarea name="options" rows={2} defaultValue={value?.options} className={inputCls} />
      </label>
      <div><button className={btnCls}>{value ? "Speichern" : "Feld anlegen"}</button></div>
    </form>
  );
}

export default async function ListsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: FlashParams }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const mayEdit = can(access, "lists", "edit");
  const mayDelete = can(access, "lists", "delete");
  const [lists, props] = await Promise.all([
    db.contactList.findMany({ where: { workspaceId: ws.id }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } }),
    listProperties(ws.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Listen & eigene Felder" description="Listen und Felder sind mit Brevo und HubSpot kompatibel: Die numerischen Listen-IDs funktionieren in der Brevo-kompatiblen API, Felder heißen wie Brevo-Attribute.">
        <Link href={`/sa/${slug}/listen/wechsel`} className={btnGhostCls}><ArrowLeftRight size={16} aria-hidden /> Wechsel: Import & Export</Link>
      </PageHeader>
      <Flash {...await searchParams} />

      <Card title="Listen">
        {lists.length === 0 ? <Empty>Noch keine Listen.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="text-left text-sm text-ink-400">
                <tr><th className="py-2 pr-3 font-medium">Name</th><th className="pr-3 font-medium">ID</th><th className="pr-3 font-medium">Mitglieder</th><th className="pr-3 font-medium">Herkunft</th><th className="font-medium">Angelegt</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                {lists.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3"><Link href={`/sa/${slug}/listen/${l.id}`} className="font-medium text-accent-500 hover:underline dark:text-accent-100">{l.name}</Link></td>
                    <td className="pr-3 font-mono text-sm">#{l.numericId}</td>
                    <td className="pr-3 tabular-nums">{l._count.members}</td>
                    <td className="pr-3">{l.source ? <Badge>{l.source}</Badge> : "–"}</td>
                    <td>{formatDate(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mayEdit && <form action={createList.bind(null, slug)} className="mt-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="new-list">Name der neuen Liste</label>
          <input id="new-list" name="name" required maxLength={120} placeholder="Name der neuen Liste" className={`${inputCls} max-w-sm`} />
          <button className={btnCls}>Liste anlegen</button>
        </form>}
      </Card>

      <Card title={<span id="felder">Eigene Felder für Kontakte</span>}>
        {props.length === 0 ? <Empty>Noch keine eigenen Felder.</Empty> : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {props.map((p) => {
              const opts = parseOptions(p.options);
              return (
                <li key={p.id} className="py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-medium">{p.label}</span>
                      <code className="text-sm text-ink-600 dark:text-ink-200">{p.key}</code>
                      <Badge tone="accent">{TYPE_LABEL[p.type] ?? p.type}</Badge>
                      {p.source && <Badge>{p.source}</Badge>}
                      {opts.length > 0 && <span className="text-sm text-ink-400">{opts.map((o) => o.label).join(", ")}</span>}
                    </summary>
                    <div className="mt-3 space-y-3">
                      {mayEdit && <PropertyForm action={saveProperty.bind(null, slug, p.id)} value={{ key: p.key, label: p.label, type: p.type, options: opts.map((o) => o.value).join("\n") }} />}
                      {mayDelete && (
                        <form action={deleteProperty.bind(null, slug, p.id)}>
                          <button className="text-sm text-red-700 hover:underline dark:text-red-300">Feld entfernen (Werte bleiben gespeichert)</button>
                        </form>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        {mayEdit && (
          <div className="mt-4 border-t border-ink-100 pt-4 dark:border-white/10">
            <h3 className="mb-2 text-sm font-semibold">Neues Feld</h3>
            <PropertyForm action={saveProperty.bind(null, slug, null)} />
          </div>
        )}
      </Card>
    </div>
  );
}

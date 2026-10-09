import { db } from "@/lib/db";
import { listProperties, parseOptions } from "@/lib/properties";
import { btnGhostCls, Card, inputCls, labelCls } from "@/components/ui";
import { saveContactAttributes, setContactLists } from "@/app/(admin)/sa/[slug]/listen/actions";

// Eigene Felder und Listen-Zugehörigkeit auf der Kontaktdetailseite.
export async function ContactExtras({
  slug,
  workspaceId,
  contactId,
  attributes,
  canEdit = true,
  canEditLists = true,
}: {
  slug: string;
  workspaceId: string;
  contactId: string;
  attributes: unknown;
  canEdit?: boolean;
  canEditLists?: boolean;
}) {
  const [props, lists, memberships] = await Promise.all([
    listProperties(workspaceId),
    db.contactList.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, numericId: true } }),
    db.contactListMember.findMany({ where: { contactId }, select: { listId: true } }),
  ]);
  const attrs = (attributes as Record<string, unknown> | null) ?? {};
  const known = new Set(props.map((p) => p.key));
  const orphan = Object.entries(attrs).filter(([k]) => !known.has(k));
  if (!props.length && !lists.length && !orphan.length) return null;
  const member = new Set(memberships.map((m) => m.listId));

  return (
    <Card title="Eigene Felder & Listen">
      {props.length > 0 && (
        <form action={saveContactAttributes.bind(null, slug, contactId)}>
          <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          {props.map((p) => {
            const v = attrs[p.key];
            const name = `attr_${p.key}`;
            return (
              <label key={p.id} className={p.type === "boolean" ? "flex items-center gap-2" : "block"}>
                {p.type === "boolean" ? (
                  <><input type="checkbox" name={name} defaultChecked={v === true || v === "true"} /> <span className="text-[15px]">{p.label}</span></>
                ) : (
                  <>
                    <span className={labelCls}>{p.label} <code className="text-xs text-ink-400">{p.key}</code></span>
                    {p.type === "select" ? (
                      <select name={name} defaultValue={v == null ? "" : String(v)} className={inputCls}>
                        <option value="">–</option>
                        {parseOptions(p.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input name={name} type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"} step="any"
                        defaultValue={v == null ? "" : p.type === "date" ? String(v).slice(0, 10) : String(v)} className={inputCls} />
                    )}
                  </>
                )}
              </label>
            );
          })}
          {canEdit && <div className="sm:col-span-2"><button className={btnGhostCls}>Felder speichern</button></div>}
          </fieldset>
        </form>
      )}
      {orphan.length > 0 && (
        <dl className="mt-3 grid gap-1 text-sm text-ink-600 dark:text-ink-200">
          {orphan.map(([k, v]) => <div key={k}><dt className="inline font-mono">{k}:</dt> <dd className="inline">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}
        </dl>
      )}
      {lists.length > 0 && (
        <form action={setContactLists.bind(null, slug, contactId)} className="mt-4 border-t border-ink-100 pt-3 dark:border-white/10">
          <fieldset disabled={!canEditLists}>
            <legend className={labelCls}>Listen</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {lists.map((l) => (
                <label key={l.id} className="inline-flex items-center gap-1.5 text-[15px]">
                  <input type="checkbox" name="listIds" value={l.id} defaultChecked={member.has(l.id)} /> {l.name}
                  <span className="text-xs text-ink-400">#{l.numericId}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {canEditLists && <button className={`${btnGhostCls} mt-2`}>Listen speichern</button>}
        </form>
      )}
    </Card>
  );
}

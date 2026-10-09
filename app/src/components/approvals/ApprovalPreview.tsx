import { db } from "@/lib/db";
import { NODE_TYPES, definitionSchema, type NodeType } from "@/lib/process/definition";
import { Badge } from "@/components/ui";

// Vorschau des Payloads je Freigabe-Art. Unbekannte Arten: gekürztes JSON (als Text, nie als HTML).

type P = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function ApprovalPreview({ kind, payload, workspaceId }: { kind: string; payload: unknown; workspaceId: string }) {
  const p = (payload && typeof payload === "object" ? payload : {}) as P;

  if (kind === "mail.send") {
    const c = await db.contact.findFirst({ where: { id: s(p.contactId), workspaceId }, select: { email: true, firstName: true, lastName: true } });
    return (
      <dl className="grid gap-2 text-[15px]">
        <div><dt className="text-sm text-ink-400">Empfänger</dt><dd>{c ? `${[c.firstName, c.lastName].filter(Boolean).join(" ")} <${c.email ?? "–"}>` : "Kontakt existiert nicht mehr"}</dd></div>
        <div><dt className="text-sm text-ink-400">Betreff</dt><dd className="font-medium">{s(p.subject)}</dd></div>
        <div>
          <dt className="text-sm text-ink-400">Text</dt>
          <dd><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-sand-100 p-3 font-sans text-sm dark:bg-white/5">{s(p.body)}</pre></dd>
        </div>
      </dl>
    );
  }

  if (kind === "contact.delete") {
    const c = await db.contact.findFirst({ where: { id: s(p.contactId), workspaceId }, select: { email: true, firstName: true, lastName: true, _count: { select: { activities: true, deals: true } } } });
    return (
      <div className="space-y-1 text-[15px]">
        <p>{c ? <>Kontakt <strong>{[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}</strong> ({c.email ?? "ohne E-Mail"}) wird endgültig gelöscht, inkl. {c._count.activities} Aktivitäten. {c._count.deals} Deal(s) verlieren die Zuordnung.</> : "Kontakt existiert nicht mehr."}</p>
        <p className="text-sm text-ink-400">Grund: {s(p.reason)}</p>
      </div>
    );
  }

  if (kind === "process.publish" || kind === "process.status" || kind === "process.enroll") {
    const proc = await db.process.findFirst({ where: { id: s(p.processId), workspaceId }, select: { name: true, objectType: true, activeVersionId: true } });
    if (!proc) return <p>Prozess existiert nicht mehr.</p>;
    const version = await db.processVersion.findFirst({
      where: {
        processId: s(p.processId),
        ...(p.versionId ? { id: s(p.versionId) } : kind === "process.publish" ? { publishedAt: null } : { id: proc.activeVersionId ?? "" }),
      },
      orderBy: { version: "desc" },
    });
    const def = version ? definitionSchema.safeParse(version.definition) : null;
    const nodes = def?.success ? def.data.nodes : [];
    const external = nodes.filter((n) => NODE_TYPES[n.type as NodeType]?.external);
    return (
      <div className="space-y-3 text-[15px]">
        <p>
          Prozess <strong>{proc.name}</strong>
          {version && <> · Version {version.version}</>}
          {kind === "process.enroll" && <> · Objekt <code className="text-sm">{s(p.objectId)}</code></>}
          {kind === "process.status" && <> · neuer Status <strong>{s(p.status)}</strong></>}
        </p>
        {def?.success ? (
          <>
            <p className="text-sm text-ink-600 dark:text-ink-200">
              Auslöser: <code>{def.data.trigger.type}</code> · {nodes.length} Schritte
            </p>
            {external.length > 0 ? (
              <div>
                <p className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-300">Schritte mit Außenwirkung – bitte genau prüfen:</p>
                <ul className="space-y-1">
                  {external.map((n) => (
                    <li key={n.id} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950">
                      <Badge tone="warn">{NODE_TYPES[n.type as NodeType]?.label ?? n.type}</Badge> {n.label ?? n.id}
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-ink-600 dark:text-ink-200">{JSON.stringify(n.config, null, 2).slice(0, 1500)}</pre>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-ink-600 dark:text-ink-200">Keine Schritte mit Außenwirkung.</p>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-accent-500 dark:text-accent-100">Alle Schritte anzeigen</summary>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
                {nodes.map((n) => (
                  <li key={n.id}>{NODE_TYPES[n.type as NodeType]?.label ?? n.type}{n.label ? ` – ${n.label}` : ""}</li>
                ))}
              </ol>
            </details>
          </>
        ) : (
          <p className="text-sm text-ink-400">Version nicht gefunden oder Definition nicht lesbar.</p>
        )}
      </div>
    );
  }

  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-sand-100 p-3 text-xs dark:bg-white/5">
      {JSON.stringify(payload, null, 2).slice(0, 4000)}
    </pre>
  );
}

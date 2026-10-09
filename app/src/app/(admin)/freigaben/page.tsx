import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { listWorkspaces } from "@/lib/workspace";
import { workspacesWithSpecial } from "@/lib/permissions/guard";
import "@/lib/approval-kinds";
import { approvalLabel } from "@/lib/approvals";
import { formatDate } from "@/lib/workspace";
import { Badge, Card, Empty, PageHeader, btnCls, btnDangerCls } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { ApprovalPreview } from "@/components/approvals/ApprovalPreview";
import { decide } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "accent" }> = {
  pending: { label: "offen", tone: "warn" },
  running: { label: "wird ausgeführt", tone: "accent" },
  approved: { label: "freigegeben", tone: "ok" },
  rejected: { label: "abgelehnt", tone: "neutral" },
  failed: { label: "fehlgeschlagen", tone: "bad" },
  expired: { label: "abgelaufen", tone: "neutral" },
};

/** Herkunft lesbar machen: mcp:<keyId> → Schlüsselname, user:<id> → Name, process:<runId> → Prozess */
async function origins(actors: string[]) {
  const keyIds = actors.filter((a) => a.startsWith("mcp:") || a.startsWith("apikey:")).map((a) => a.split(":")[1]);
  const userIds = actors.filter((a) => a.startsWith("user:")).map((a) => a.slice(5));
  const [keys, users] = await Promise.all([
    db.apiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const names = new Map<string, string>([...keys.map((k) => [k.id, k.name] as const), ...users.map((u) => [u.id, u.name] as const)]);
  return (actor: string) => {
    const [kind, id] = [actor.split(":")[0], actor.split(":").slice(1).join(":")];
    if (kind === "mcp") return `KI über MCP (${names.get(id) ?? "Schlüssel"})`;
    if (kind === "apikey") return `API (${names.get(id) ?? "Schlüssel"})`;
    if (kind === "user") return names.get(id) ?? "Benutzer";
    if (kind === "process") return "Prozess";
    return actor;
  };
}

export default async function FreigabenPage({ searchParams }: { searchParams: Promise<{ ok?: string; fehler?: string; id?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  // Sub-Accounts, in denen der Benutzer „Freigaben erteilen“ darf
  const adminWs = await workspacesWithSpecial(user.id, (await listWorkspaces()).map((w) => w.id), "approve");

  // Abgelaufene offene Freigaben kennzeichnen
  await db.approval.updateMany({ where: { workspaceId: { in: adminWs }, status: "pending", expiresAt: { lt: new Date() } }, data: { status: "expired" } });

  const [open, history, workspaces] = await Promise.all([
    db.approval.findMany({ where: { workspaceId: { in: adminWs }, status: "pending" }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.approval.findMany({ where: { workspaceId: { in: adminWs }, status: { not: "pending" } }, orderBy: { decidedAt: "desc" }, take: 50 }),
    db.workspace.findMany({ where: { id: { in: adminWs } }, select: { id: true, name: true, slug: true, brandPrimary: true } }),
  ]);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const origin = await origins([...open, ...history].flatMap((a) => [a.requestedBy, a.decidedBy ?? ""]).filter(Boolean));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Freigaben"
        description="Aktionen mit Außenwirkung – aus KI-Zugriffen (MCP), Prozessen oder Schnittstellen – warten hier, bis ein Mensch zustimmt. Nur Admins des jeweiligen Sub-Accounts entscheiden."
      />
      <Flash ok={sp.ok} fehler={sp.fehler} />

      {adminWs.length === 0 && <Card><Empty>Sie haben in keinem Sub-Account das Recht „Freigaben erteilen“.</Empty></Card>}

      <section aria-labelledby="offen" className="space-y-4">
        <h2 id="offen" className="text-lg font-semibold">Offen ({open.length})</h2>
        {open.length === 0 && adminWs.length > 0 && <Card><Empty>Keine offenen Freigaben.</Empty></Card>}
        {open.map((a) => {
          const ws = wsById.get(a.workspaceId);
          return (
            <Card key={a.id} className={sp.id === a.id ? "ring-2 ring-accent-500" : ""}>
              <div id={a.id} className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-ink-400 dark:text-ink-200">
                    {ws && (
                      <Link href={`/sa/${ws.slug}`} className="inline-flex items-center gap-1.5 hover:underline">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: ws.brandPrimary }} aria-hidden />
                        {ws.name}
                      </Link>
                    )}
                    <Badge tone="accent">{approvalLabel(a.kind)}</Badge>
                    <span>von {origin(a.requestedBy)}</span>
                    <span>· {formatDate(a.createdAt, true)}</span>
                    {a.expiresAt && <span>· läuft ab {formatDate(a.expiresAt)}</span>}
                  </div>
                  <h3 className="mt-1 text-[17px] font-semibold text-ink-900 dark:text-ink-50">{a.title}</h3>
                  {a.summary && <p className="mt-1 whitespace-pre-wrap text-ink-600 dark:text-ink-200">{a.summary}</p>}
                </div>
              </div>
              <ApprovalPreview kind={a.kind} payload={a.payload} workspaceId={a.workspaceId} />
              <form action={decide} className="mt-4 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={a.id} />
                <button name="decision" value="approved" className={btnCls}>Zustimmen und ausführen</button>
                <button name="decision" value="rejected" className={btnDangerCls}>Ablehnen</button>
              </form>
            </Card>
          );
        })}
      </section>

      <Card title="Verlauf (letzte 50)">
        {history.length === 0 ? (
          <Empty>Noch keine Entscheidungen.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-400">
                <tr><th className="py-1.5 pr-3 font-medium">Zeit</th><th className="pr-3 font-medium">Sub-Account</th><th className="pr-3 font-medium">Art</th><th className="pr-3 font-medium">Titel</th><th className="pr-3 font-medium">Herkunft</th><th className="pr-3 font-medium">Entschieden von</th><th className="font-medium">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                {history.map((a) => {
                  const st = STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
                  const err = a.status === "failed" && a.result && typeof a.result === "object" ? String((a.result as Record<string, unknown>).error ?? "") : "";
                  return (
                    <tr key={a.id}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(a.decidedAt ?? a.createdAt, true)}</td>
                      <td className="pr-3">{wsById.get(a.workspaceId)?.name}</td>
                      <td className="pr-3">{approvalLabel(a.kind)}</td>
                      <td className="pr-3">{a.title}{err && <span className="block text-xs text-red-700 dark:text-red-300">{err}</span>}</td>
                      <td className="pr-3">{origin(a.requestedBy)}</td>
                      <td className="pr-3">{a.decidedBy ? origin(a.decidedBy) : "–"}</td>
                      <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { mcpResource } from "@/lib/oauth/config";
import { formatDate } from "@/lib/workspace";
import { Badge, Card, Empty, PageHeader, btnDangerCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Widerruft alle Tokens eines Clients für den angemeldeten Benutzer in einem Sub-Account. */
async function revokeApp(formData: FormData) {
  "use server";
  const user = await requireUser();
  const { clientId, workspaceId } = z.object({ clientId: z.string().min(1).max(60), workspaceId: z.string().min(1).max(60) }).parse({
    clientId: formData.get("clientId"),
    workspaceId: formData.get("workspaceId"),
  });
  const res = await db.oAuthToken.updateMany({ where: { userId: user.id, clientId, workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ workspaceId, actor: `user:${user.id}`, action: "oauth.revoked", target: clientId, detail: { tokens: res.count } });
  revalidatePath("/konto/apps");
}

export default async function ConnectedAppsPage() {
  const user = await requireUser();
  // Aktive Verbindungen: noch nicht widerrufene Tokens mit gültigem Refresh-Token
  const tokens = await db.oAuthToken.findMany({
    where: { userId: user.id, revokedAt: null, refreshExpiresAt: { gt: new Date() } },
    include: { client: { select: { id: true, name: true, clientId: true, registeredBy: true } } },
    orderBy: { createdAt: "desc" },
  });
  const workspaces = await db.workspace.findMany({ where: { id: { in: [...new Set(tokens.map((t) => t.workspaceId))] } }, select: { id: true, name: true } });
  const wsName = Object.fromEntries(workspaces.map((w) => [w.id, w.name]));
  const groups = new Map<string, (typeof tokens)[number][]>();
  for (const t of tokens) {
    const k = `${t.clientId}|${t.workspaceId}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Verbundene Apps" description="KI-Assistenten und Werkzeuge, denen Sie per OAuth Zugriff auf das CRM gegeben haben. Sie handeln in Ihrem Namen und haben höchstens Ihre Rechte." />
      <p className="mb-4 text-sm text-ink-600 dark:text-ink-200">
        Adresse für Konnektoren (z. B. claude.ai, ChatGPT, Claude Code): <code className="rounded bg-sand-100 px-1.5 py-0.5 dark:bg-white/10">{mcpResource()}</code>
      </p>
      <Card>
        {groups.size === 0 ? (
          <Empty>Keine verbundenen Apps.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {[...groups.values()].map((list) => {
              const t = list[0];
              const lastUsed = list.map((x) => x.lastUsedAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
              const write = list.some((x) => x.scopes.includes("mcp:write"));
              return (
                <li key={`${t.clientId}|${t.workspaceId}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-medium text-ink-900 dark:text-ink-50">{t.client.name}</div>
                    <div className="text-sm text-ink-400 dark:text-ink-200">
                      {wsName[t.workspaceId] ?? "Sub-Account"} · verbunden seit {formatDate(list[list.length - 1].createdAt)} · zuletzt genutzt {formatDate(lastUsed, true)}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <Badge tone={write ? "warn" : "neutral"}>{write ? "lesen und ändern" : "nur lesen"}</Badge>
                      <Badge>{t.client.registeredBy === "cimd" ? "Metadaten-Client" : "registrierter Client"}</Badge>
                    </div>
                  </div>
                  <form action={revokeApp}>
                    <input type="hidden" name="clientId" value={t.client.id} />
                    <input type="hidden" name="workspaceId" value={t.workspaceId} />
                    <button className={btnDangerCls}>Zugriff widerrufen</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="mt-4 text-sm"><Link href="/konto" className="text-accent-500 dark:text-accent-100 hover:underline">← Zurück zum Konto</Link></p>
    </div>
  );
}

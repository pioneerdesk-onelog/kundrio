import Link from "next/link";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/workspace";
import { ALL_TOOLS } from "@/lib/mcp-admin/tools";
import { Badge, Card, Empty, btnGhostCls } from "@/components/ui";
import { CopyButton } from "@/components/mail/CopyButton";

// Reiter „MCP“ unter API & Schnittstellen: Verbindung für externe LLMs, Werkzeugübersicht, Protokoll.

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-ink-900 p-3 pr-24 text-[13px] leading-relaxed text-ink-50">{children}</pre>
      <div className="absolute top-2 right-2"><CopyButton text={children} /></div>
    </div>
  );
}

const ACCESS_LABEL = { read: "lesen", write: "ändern", approval: "nur mit Freigabe" } as const;
const ACCESS_TONE = { read: "neutral", write: "accent", approval: "warn" } as const;

export async function McpTab({ slug, workspaceId }: { slug: string; workspaceId: string }) {
  const url = `${env.appUrl().replace(/\/$/, "")}/api/mcp`;
  const https = url.startsWith("https://");
  const [keys, calls] = await Promise.all([
    db.apiKey.findMany({ where: { workspaceId, revokedAt: null, scopes: { hasSome: ["mcp:read", "mcp:write"] } }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { workspaceId, actor: { startsWith: "mcp:" } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const keyNames = new Map((await db.apiKey.findMany({ where: { workspaceId }, select: { id: true, name: true } })).map((k) => [k.id, k.name]));

  const claudeCode = `claude mcp add --transport http kundrio ${url} \\\n  --header "Authorization: Bearer pdk_…"`;
  const jsonConfig = JSON.stringify(
    { mcpServers: { "kundrio": { type: "http", url, headers: { Authorization: "Bearer pdk_…" } } } },
    null,
    2,
  );
  const curl = `curl -s ${url} \\\n  -H "Authorization: Bearer pdk_…" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <div className="space-y-6">
      <Card title="KI-Steuerung per MCP">
        <p className="max-w-prose text-ink-600 dark:text-ink-200">
          Über das Model Context Protocol (MCP) können externe KI-Assistenten – Claude, ChatGPT oder lokale Modelle – diesen Sub-Account lesen, Daten pflegen und
          vor allem <strong>Prozesse entwerfen, prüfen und testen</strong>. Alles mit Außenwirkung (E-Mails, Webhooks, Löschen, Veröffentlichen) landet im{" "}
          <Link href="/freigaben" className="text-accent-500 underline dark:text-accent-100">Freigabe-Eingang</Link> und wird erst nach Ihrer Zustimmung ausgeführt.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink-400">Endpunkt</dt>
            <dd className="flex items-center gap-2"><code className="break-all text-sm">{url}</code><CopyButton text={url} /></dd>
          </div>
          <div>
            <dt className="text-sm text-ink-400">Anmeldung</dt>
            <dd className="text-[15px]">API-Schlüssel dieses Sub-Accounts mit <code>mcp:read</code> (lesen) und optional <code>mcp:write</code> (ändern)</dd>
          </div>
        </dl>
        {!https && (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            Das CRM läuft derzeit nur lokal ({url}). Von außen erreichbar ist der MCP-Server erst im HTTPS-Betrieb. Lokal funktionieren Claude Code und lokale Modelle bereits.
          </p>
        )}
      </Card>

      <Card title="Schlüssel mit MCP-Berechtigung">
        {keys.length === 0 ? (
          <Empty>Noch kein Schlüssel mit MCP-Berechtigung.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 text-[15px] dark:divide-white/10">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-medium">{k.name}</span>
                <code className="text-sm text-ink-400">{k.prefix}_…</code>
                {k.scopes.filter((s) => s.startsWith("mcp:")).map((s) => <Badge key={s} tone={s === "mcp:write" ? "accent" : "neutral"}>{s}</Badge>)}
                <span className="ml-auto text-sm text-ink-400">zuletzt genutzt {formatDate(k.lastUsedAt, true)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/sa/${slug}/api?tab=schluessel`} className={`${btnGhostCls} mt-3`}>Schlüssel anlegen (Häkchen bei mcp:read / mcp:write)</Link>
        <p className="mt-2 text-sm text-ink-400">Tipp: Für reine Auswertungen einen Schlüssel nur mit <code>mcp:read</code> anlegen. Schlüssel jederzeit im Reiter „Schlüssel“ widerrufbar.</p>
      </Card>

      <Card title="Verbinden">
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 font-medium">Claude Code</h3>
            <Code>{claudeCode}</Code>
          </div>
          <div>
            <h3 className="mb-1 font-medium">Claude Desktop, Cursor und andere Clients (JSON-Konfiguration)</h3>
            <Code>{jsonConfig}</Code>
          </div>
          <div>
            <h3 className="mb-1 font-medium">Lokale Modelle / eigene Agenten</h3>
            <p className="mb-2 text-sm text-ink-600 dark:text-ink-200">
              Jeder MCP-Client mit „Streamable HTTP“ funktioniert (z. B. HUGIN, Open WebUI mit MCP-Brücke). Zum Ausprobieren per curl:
            </p>
            <Code>{curl}</Code>
          </div>
          <p className="rounded-md bg-sand-100 px-3 py-2 text-sm text-ink-600 dark:bg-white/5 dark:text-ink-200">
            <strong>OAuth 2.1 (empfohlen):</strong> Konnektoren in claude.ai, ChatGPT oder Claude Desktop/Code verbinden sich ohne Schlüssel – einfach die Adresse{" "}
            <code>{url}</code> eintragen. Die Anmeldung erfolgt im Browser; die App handelt im Namen des Benutzers und hat höchstens dessen Rechte
            (Widerruf unter <em>Mein Konto → Verbundene Apps</em>). Von außen erreichbar erst mit HTTPS-Betrieb; bis dahin lokal per Schlüssel.
          </p>
        </div>
      </Card>

      <Card title={`Werkzeuge (${ALL_TOOLS.length})`}>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {ALL_TOOLS.map((t) => (
            <li key={t.name} className="flex items-baseline gap-2">
              <code className="text-[13px]">{t.name}</code>
              <span className="text-ink-600 dark:text-ink-200">{t.title}</span>
              <span className="ml-auto"><Badge tone={ACCESS_TONE[t.access]}>{ACCESS_LABEL[t.access]}</Badge></span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Protokoll der MCP-Aufrufe (letzte 50)">
        {calls.length === 0 ? (
          <Empty>Noch keine Aufrufe.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-ink-400">
                <tr><th className="py-1.5 pr-3 font-medium">Zeit</th><th className="pr-3 font-medium">Schlüssel</th><th className="pr-3 font-medium">Werkzeug</th><th className="pr-3 font-medium">Ergebnis</th><th className="font-medium">Dauer</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-white/10">
                {calls.map((c) => {
                  const d = (c.detail ?? {}) as Record<string, unknown>;
                  const outcome = String(d.outcome ?? "");
                  return (
                    <tr key={c.id}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(c.createdAt, true)}</td>
                      <td className="pr-3">{keyNames.get(c.actor.slice(4)) ?? "gelöscht"}</td>
                      <td className="pr-3"><code>{c.action.replace(/^mcp\./, "")}</code></td>
                      <td className="pr-3"><Badge tone={outcome === "ok" ? "ok" : outcome === "internal_error" ? "bad" : "warn"}>{outcome || "–"}</Badge></td>
                      <td>{typeof d.ms === "number" ? `${d.ms} ms` : "–"}</td>
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

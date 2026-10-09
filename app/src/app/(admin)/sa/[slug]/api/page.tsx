import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/workspace";
import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { SCOPES } from "@/lib/apikey";
import { WEBHOOK_EVENTS } from "@/lib/mail-schema";
import { Badge, Card, Empty, PageHeader, btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { Flash } from "@/components/b/Flash";
import { SubmitButton } from "@/components/c/SubmitButton";
import { NewKeyForm } from "@/components/mail/NewKeyForm";
import { MigrationGuide } from "@/components/mail/MigrationGuide";
import { CopyButton } from "@/components/mail/CopyButton";
import { McpTab } from "@/components/approvals/McpTab";
import {
  addSuppression, createKeyAction, createWebhook, deleteWebhook, removeSuppression, revokeKey, testWebhook, toggleWebhook,
} from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["schluessel", "Schlüssel"],
  ["webhooks", "Webhooks"],
  ["protokoll", "Versandprotokoll"],
  ["sperrliste", "Sperrliste"],
  ["umstieg", "Umstieg von Brevo"],
  ["mcp", "MCP (KI-Steuerung)"],
] as const;

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "accent"> = {
  delivered: "ok", sent: "ok", captured: "accent", queued: "neutral", soft_bounce: "warn", deferred: "warn",
  hard_bounce: "bad", blocked: "bad", spam: "bad", failed: "bad",
};

type SP = { tab?: string; ok?: string; fehler?: string; email?: string; status?: string; kind?: string };

export default async function ApiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { ws, access } = await pageAccess(slug);
  // Schlüssel/Webhooks/Sperrliste ändern: „API-, MCP- und Webhook-Zugänge verwalten“;
  // Versandprotokoll/Sperrliste lesen: E-Mail lesen; MCP-Protokoll: zusätzlich „Audit ansehen“.
  const admin = hasSpecial(access, "manage_keys");
  const allowed: Record<string, boolean> = {
    schluessel: admin,
    webhooks: admin,
    protokoll: can(access, "email", "read"),
    sperrliste: can(access, "email", "read"),
    umstieg: admin,
    mcp: admin || hasSpecial(access, "view_audit"),
  };
  const tabs = TABS.filter(([k]) => allowed[k]);
  const tab = tabs.some(([k]) => k === sp.tab) ? sp.tab! : (tabs[0]?.[0] ?? "protokoll");
  const base = `${env.appUrl().replace(/\/$/, "")}/api/brevo/v3`;

  return (
    <div className="space-y-6">
      <PageHeader title="API & Schnittstellen" description="Brevo-kompatible Schnittstelle für Transaktionsmails: Produkte wechseln nur Basis-URL und Schlüssel.">
        <Link href={`/sa/${slug}/email/vorlagen`} className={btnGhostCls}>E-Mail-Vorlagen</Link>
      </PageHeader>
      <Flash ok={sp.ok} fehler={sp.fehler} />

      <nav aria-label="Bereiche" className="flex flex-wrap gap-1">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/sa/${slug}/api?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-[15px] ${tab === k ? "bg-accent-500 text-white" : "border border-ink-200 hover:bg-sand-100 dark:border-white/15 dark:hover:bg-white/10"}`}>
            {label}
          </Link>
        ))}
      </nav>

      {!admin && tab !== "protokoll" && tab !== "umstieg" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Änderungen erfordern das Recht „API-, MCP- und Webhook-Zugänge verwalten“.
        </p>
      )}

      {tab === "schluessel" && admin && <KeysTab slug={slug} workspaceId={ws.id} admin={admin} base={base} />}
      {tab === "webhooks" && admin && <WebhooksTab slug={slug} workspaceId={ws.id} admin={admin} />}
      {tab === "protokoll" && allowed.protokoll && <LogTab workspaceId={ws.id} sp={sp} />}
      {tab === "sperrliste" && allowed.sperrliste && <SuppressionTab slug={slug} workspaceId={ws.id} admin={admin} />}
      {tab === "mcp" && allowed.mcp && <McpTab slug={slug} workspaceId={ws.id} />}
      {tab === "umstieg" && admin && (
        <MigrationGuide base={base} eventsUrl={`${env.appUrl().replace(/\/$/, "")}/api/mail/events/brevo`} eventsConfigured={(process.env.MAIL_EVENTS_SECRET ?? "").length >= 16} />
      )}
    </div>
  );
}

async function KeysTab({ slug, workspaceId, admin, base }: { slug: string; workspaceId: string; admin: boolean; base: string }) {
  const keys = await db.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Basis-URL für Produkte">
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-sand-100 px-2 py-1 font-mono text-sm dark:bg-white/10">{base}</code>
          <CopyButton text={base} />
        </div>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">Header <code>api-key: pdk_…</code> (wie bei Brevo) oder <code>Authorization: Bearer pdk_…</code>.</p>
      </Card>
      {admin && (
        <Card title="Neuen Schlüssel anlegen">
          <NewKeyForm action={createKeyAction.bind(null, slug)} scopes={SCOPES} />
        </Card>
      )}
      <Card title="Schlüssel" className="xl:col-span-2">
        {keys.length === 0 ? <Empty>Noch keine Schlüssel.</Empty> : (
          <table className="w-full text-left text-[15px]">
            <thead className="text-sm text-ink-400 dark:text-ink-200"><tr><th className="py-2 pr-3">Name</th><th className="pr-3">Kennung</th><th className="pr-3">Rechte</th><th className="pr-3">Zuletzt genutzt</th><th className="pr-3">Status</th><th /></tr></thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="py-2 pr-3">{k.name}<div className="text-xs text-ink-400">von {k.createdBy ?? "–"}, {formatDate(k.createdAt)}</div></td>
                  <td className="pr-3 font-mono text-sm">{k.prefix}_…</td>
                  <td className="pr-3 text-sm">{k.scopes.join(", ")}</td>
                  <td className="pr-3">{formatDate(k.lastUsedAt, true)}</td>
                  <td className="pr-3">{k.revokedAt ? <Badge tone="bad">widerrufen</Badge> : <Badge tone="ok">aktiv</Badge>}</td>
                  <td className="text-right">
                    {admin && !k.revokedAt && (
                      <form action={revokeKey.bind(null, slug, k.id)}><SubmitButton ghost confirm={`Schlüssel „${k.name}“ widerrufen? Produkte damit können dann nicht mehr senden.`}>Widerrufen</SubmitButton></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

async function WebhooksTab({ slug, workspaceId, admin }: { slug: string; workspaceId: string; admin: boolean }) {
  const hooks = await db.webhook.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-6">
      <Card title="Webhooks">
        {hooks.length === 0 ? <Empty>Noch keine Webhooks.</Empty> : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm break-all">#{h.numericId} · {h.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={h.active ? "ok" : "neutral"}>{h.active ? "aktiv" : "pausiert"}</Badge>
                    <Badge>{h.type}</Badge>
                    {h.events.map((e) => <Badge key={e} tone="accent">{e}</Badge>)}
                  </div>
                  {h.description && <div className="mt-1 text-sm text-ink-600 dark:text-ink-200">{h.description}</div>}
                  <div className="mt-1 text-xs text-ink-400">
                    Letzte Zustellung: {h.lastAt ? `${formatDate(h.lastAt, true)} – ${h.lastError ?? `HTTP ${h.lastStatus}`}` : "noch keine"}
                  </div>
                  {admin && h.secret && (
                    <details className="mt-1 text-xs"><summary className="cursor-pointer">Signatur-Geheimnis anzeigen</summary>
                      <code className="break-all">{h.secret}</code> – Prüfung: <code>X-PD-Signature: sha256=HMAC(secret, body)</code>
                    </details>
                  )}
                </div>
                {admin && (
                  <div className="flex gap-2">
                    <form action={testWebhook.bind(null, slug, h.id)}><SubmitButton ghost pending="Teste …">Testen</SubmitButton></form>
                    <form action={toggleWebhook.bind(null, slug, h.id)}><button className={btnGhostCls}>{h.active ? "Pausieren" : "Aktivieren"}</button></form>
                    <form action={deleteWebhook.bind(null, slug, h.id)}><SubmitButton ghost confirm="Webhook löschen?">Löschen</SubmitButton></form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {admin && (
        <Card title="Webhook anlegen">
          <form action={createWebhook.bind(null, slug)} className="grid gap-4">
            <label><span className={labelCls}>Ziel-URL (https)</span><input name="url" type="url" required className={inputCls} placeholder="https://produkt.example/hooks/mail" /></label>
            <label><span className={labelCls}>Beschreibung</span><input name="description" maxLength={300} className={inputCls} /></label>
            <label><span className={labelCls}>Art</span>
              <select name="type" className={inputCls}><option value="transactional">Transaktional</option><option value="marketing">Marketing (Kampagnen)</option></select>
            </label>
            <fieldset><legend className={labelCls}>Ereignisse</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {Object.keys(WEBHOOK_EVENTS).filter((e) => e !== "sent").map((e) => (
                  <label key={e} className="flex items-center gap-2 text-[15px]"><input type="checkbox" name="events" value={e} defaultChecked={["delivered", "hardBounce", "spam", "blocked"].includes(e)} /> {e}</label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" name="sign" defaultChecked /> Zustellungen signieren (Header <code>X-PD-Signature</code>)</label>
            <div><button className={btnCls}>Anlegen</button></div>
          </form>
        </Card>
      )}
    </div>
  );
}

async function LogTab({ workspaceId, sp }: { workspaceId: string; sp: SP }) {
  const where: Prisma.EmailMessageWhereInput = { workspaceId, direction: "OUT" };
  if (sp.email) where.toAddr = { contains: sp.email.toLowerCase().slice(0, 200) };
  if (sp.status) where.status = sp.status;
  if (sp.kind) where.kind = sp.kind;
  const rows = await db.emailMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { events: { orderBy: { at: "asc" } } } });
  return (
    <Card title="Versandprotokoll (letzte 100)">
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="protokoll" />
        <label><span className={labelCls}>Empfänger</span><input name="email" defaultValue={sp.email} className={inputCls} /></label>
        <label><span className={labelCls}>Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
            <option value="">alle</option>
            {["queued", "captured", "sent", "delivered", "soft_bounce", "hard_bounce", "blocked", "spam", "failed"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label><span className={labelCls}>Art</span>
          <select name="kind" defaultValue={sp.kind ?? ""} className={inputCls}>
            <option value="">alle</option>
            {["transactional", "campaign", "one_to_one", "system"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button className={btnGhostCls}>Filtern</button>
      </form>
      {rows.length === 0 ? <Empty>Keine Nachrichten.</Empty> : (
        <ul className="divide-y divide-ink-100 dark:divide-white/10">
          {rows.map((m) => (
            <li key={m.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2 text-[15px]">
                <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                <Badge>{m.kind}</Badge>
                <span className="font-medium">{m.subject}</span>
                <span className="text-ink-400">→ {m.toAddr}</span>
              </div>
              <div className="mt-1 text-xs text-ink-400">
                {formatDate(m.createdAt, true)} · von {m.fromAddr}{m.tags.length ? ` · Tags: ${m.tags.join(", ")}` : ""} · <span className="font-mono">{m.messageId}</span>
              </div>
              {m.error && <div className="mt-1 text-sm text-red-700 dark:text-red-300">{m.error}</div>}
              {m.events.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 text-xs">
                  {m.events.map((e) => <span key={e.id} className="rounded bg-sand-100 px-1.5 py-0.5 dark:bg-white/10">{e.event}{e.reason ? `: ${e.reason}` : ""} · {formatDate(e.at, true)}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-400">Link zur Detailansicht in Mailpit (nur lokal): <a className="underline" href="http://127.0.0.1:58025" target="_blank" rel="noreferrer">127.0.0.1:58025</a></p>
    </Card>
  );
}

async function SuppressionTab({ slug, workspaceId, admin }: { slug: string; workspaceId: string; admin: boolean }) {
  const rows = await db.suppression.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 500 });
  return (
    <div className="space-y-6">
      <Card title={`Sperrliste (${rows.length})`}>
        <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Gesperrte Adressen erhalten <strong>keine</strong> Mails mehr – auch keine transaktionalen. Abmeldungen vom Newsletter stehen nicht hier, sie sperren nur Marketing.</p>
        {rows.length === 0 ? <Empty>Keine gesperrten Adressen.</Empty> : (
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <span className="font-medium">{s.email}</span> <Badge tone={s.reason === "manual" ? "neutral" : "bad"}>{s.reason}</Badge>
                  <div className="text-xs text-ink-400">{formatDate(s.createdAt, true)}{s.source ? ` · ${s.source}` : ""}</div>
                </div>
                {admin && (
                  <form action={removeSuppression.bind(null, slug, s.id)} className="flex items-center gap-2">
                    <input name="note" required minLength={3} maxLength={200} placeholder="Grund der Aufhebung" className={`${inputCls} w-56`} />
                    <SubmitButton ghost confirm={`${s.email} wirklich entsperren?`}>Entsperren</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {admin && (
        <Card title="Adresse sperren">
          <form action={addSuppression.bind(null, slug)} className="flex flex-wrap items-end gap-2">
            <label><span className={labelCls}>E-Mail</span><input name="email" type="email" required className={inputCls} /></label>
            <label className="min-w-64 flex-1"><span className={labelCls}>Begründung</span><input name="note" required minLength={3} maxLength={200} className={inputCls} /></label>
            <button className={btnCls}>Sperren</button>
          </form>
        </Card>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkAuthorizeRequest, type AuthorizeParams } from "@/lib/oauth/authorize";
import { redirectHost } from "@/lib/oauth/redirect";
import { SCOPE_WRITE } from "@/lib/oauth/config";
import { getAccess, isAgencyStaff } from "@/lib/permissions";
import { KundrioLogo } from "@/components/KundrioLogo";
import { btnCls, btnGhostCls, labelCls, inputCls } from "@/components/ui";
import { decide } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zugriff erlauben – Kundrio", robots: { index: false } };

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p: AuthorizeParams = {};
  for (const f of FIELDS) {
    const v = sp[f];
    if (typeof v === "string") p[f] = v;
  }

  const check = await checkAuthorizeRequest(p);
  if (check.kind === "fatal") return <Frame><h1 className="mb-3 font-display text-2xl">Anfrage abgelehnt</h1><p className="text-ink-600 dark:text-ink-200">{check.message}</p></Frame>;
  if (check.kind === "redirect_error") redirect(check.url);

  const user = await getCurrentUser();
  if (!user) {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const candidates = await db.workspace.findMany({
    where: isAgencyStaff(user) ? {} : { memberships: { some: { userId: user.id } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, domain: true },
  });
  const workspaces = [];
  for (const w of candidates) if (await getAccess(user.id, w.id)) workspaces.push(w);
  const canWrite = check.requestedScopes.includes(SCOPE_WRITE);

  return (
    <Frame>
      <div className="mb-4 flex items-center gap-2 text-accent-500 dark:text-accent-100"><ShieldCheck size={22} aria-hidden /><span className="text-sm font-semibold uppercase tracking-wider">Zugriff erlauben</span></div>
      <h1 className="mb-2 font-display text-2xl text-ink-900 dark:text-ink-50">„{check.client.name}“ möchte auf Ihr CRM zugreifen</h1>
      <p className="mb-4 text-ink-600 dark:text-ink-200">
        Angemeldet als <strong>{user.name}</strong>. Die Anwendung handelt in Ihrem Namen und bekommt höchstens Ihre eigenen Rechte.
      </p>
      <dl className="mb-4 rounded-lg border border-ink-100 bg-sand-50 p-3 text-sm dark:border-white/10 dark:bg-white/5">
        <dt className="text-ink-400">Rücksprung nach Zustimmung an</dt>
        <dd className="font-mono text-base font-semibold text-ink-900 dark:text-ink-50">{redirectHost(check.redirectUri)}</dd>
        <dt className="mt-2 text-ink-400">Client-Kennung</dt>
        <dd className="break-all font-mono text-xs">{check.client.clientId}</dd>
      </dl>
      {check.localhostOnly && (
        <p role="alert" className="mb-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          Diese Anwendung läuft lokal auf einem Rechner (localhost). Erlauben Sie den Zugriff nur, wenn Sie die Verbindung gerade selbst gestartet haben.
        </p>
      )}
      {workspaces.length === 0 ? (
        <p className="text-ink-600">Sie haben auf keinen Sub-Account Zugriff.</p>
      ) : (
        <form action={decide} className="space-y-4">
          {FIELDS.map((f) => (p[f] ? <input key={f} type="hidden" name={f} value={p[f]} /> : null))}
          <label className="block">
            <span className={labelCls}>Sub-Account</span>
            <select name="workspaceId" required className={inputCls} defaultValue={workspaces[0].id}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.domain ? ` (${w.domain})` : ""}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className={labelCls}>Umfang</legend>
            <label className="flex items-start gap-2 py-1">
              <input type="radio" name="access" value="read" defaultChecked={!canWrite} className="mt-1" />
              <span><strong>Nur lesen</strong> – Kontakte, Deals, Tickets, Prozesse und Kennzahlen ansehen.</span>
            </label>
            {canWrite && (
              <label className="flex items-start gap-2 py-1">
                <input type="radio" name="access" value="write" defaultChecked className="mt-1" />
                <span><strong>Lesen und ändern</strong> – Datensätze anlegen und bearbeiten, Prozesse als Entwurf bauen und testen.</span>
              </label>
            )}
          </fieldset>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Aktionen mit Außenwirkung (E-Mails, Veröffentlichen von Prozessen, Löschen) werden nie direkt ausgeführt, sondern landen im Freigabe-Eingang.
            Sie können den Zugriff jederzeit unter <em>Mein Konto → Verbundene Apps</em> widerrufen.
          </p>
          <div className="flex gap-2">
            <button name="decision" value="allow" className={btnCls}>Zugriff erlauben</button>
            <button name="decision" value="deny" className={btnGhostCls} formNoValidate>Ablehnen</button>
          </div>
        </form>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-lg">
      <div className="mb-6 flex justify-center"><KundrioLogo className="h-9" /></div>
      <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-ink-900">{children}</div>
    </div>
  );
}

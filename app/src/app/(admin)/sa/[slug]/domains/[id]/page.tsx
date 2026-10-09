import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { NoAccess } from "@/components/users/NoAccess";
import { CopyButton } from "@/components/mail/CopyButton";
import { db } from "@/lib/db";
import { hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { guideFor } from "@/lib/domains/guides";
import { relativeName } from "@/lib/domains/hostname";
import { describeProvider, records, report, zoneFromDomain } from "@/lib/domains/service";
import { ApiSetup } from "../ApiSetup";
import { DomainConnectButton } from "../DomainConnectButton";
import { StackitMigration } from "../StackitMigration";
import { migrationOf, platformAvailable } from "@/lib/domains/stackit-migration";
import { STATUS } from "../status";
import { applyApiAction, checkNowAction, domainConnectAction, forgetCredentialsAction, previewApiAction, removeDomainAction } from "../actions";

export const dynamic = "force-dynamic";

const fmt = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)) : "–");
const PURPOSE: Record<string, string> = { landing: "Weiterleitung auf die Landingpages", verify: "Besitznachweis", spf: "SPF (Absender erlauben)", dkim: "DKIM (Signatur)", dmarc: "DMARC (Richtlinie)" };
const REC_TONE = { ok: "ok", missing: "warn", wrong: "bad" } as const;
const REC_LABEL = { ok: "korrekt", missing: "fehlt", wrong: "falscher Wert" } as const;

export default async function DomainDetail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { ws, access } = await pageAccess(slug);
  if (!hasSpecial(access, "manage_settings")) return <NoAccess what="Domains" />;
  const d = await db.domain.findFirst({ where: { id, workspaceId: ws.id } });
  if (!d) notFound();

  const zone = zoneFromDomain(d);
  const provider = describeProvider(d.dnsProvider);
  const guide = guideFor(provider.key);
  const desired = records(d);
  const rep = report(d);
  const checks = new Map((rep?.records ?? []).map((r) => [`${r.type} ${r.name}`, r]));
  const ns = (rep as { nameservers?: string[] } | null)?.nameservers ?? [];
  const st = STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };

  return (
    <div className="space-y-6">
      <PageHeader title={d.hostname} description={`${d.purpose === "mail" ? "E-Mail-Versand" : "Landingpages"} · Zone ${zone} · Anbieter: ${provider.name}${ns.length ? ` (${ns.slice(0, 2).join(", ")})` : ""}`}>
        <Link className="text-sm underline" href={`/sa/${slug}/domains`}>Alle Domains</Link>
      </PageHeader>

      <Card title={<span className="flex items-center gap-2">Status <Badge tone={st.tone}>{st.label}</Badge></span>}>
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div><dt className="text-ink-400">Zuletzt geprüft</dt><dd>{fmt(d.lastCheckAt)}</dd></div>
          <div><dt className="text-ink-400">Aktiv seit</dt><dd>{fmt(d.verifiedAt)}</dd></div>
          <div><dt className="text-ink-400">Verbreitung</dt><dd>{rep?.propagation ? `${rep.propagation.ok} von ${rep.propagation.total} Resolvern` : "–"}</dd></div>
          <div><dt className="text-ink-400">HTTPS</dt><dd>{rep?.https ? (rep.https.ok ? `gültig bis ${fmt(rep.https.validTo)}${rep.https.issuer ? ` (${rep.https.issuer})` : ""}` : `nicht bereit: ${rep.https.error ?? "–"}`) : "–"}</dd></div>
        </dl>
        {rep?.cnameChain?.length ? <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">Auflösung: {d.hostname} → {rep.cnameChain.join(" → ")}</p> : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <StateForm action={checkNowAction.bind(null, slug, d.id)} inline>
            <Submit variant="ghost">Jetzt prüfen</Submit>
          </StateForm>
          {d.status === "active" && d.purpose === "landing" && (
            <a className="text-sm font-medium text-accent-500 underline dark:text-accent-100" href={`https://${d.hostname}/`} target="_blank" rel="noopener noreferrer">Seite öffnen</a>
          )}
        </div>
      </Card>

      <Card title="Benötigte DNS-Einträge">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Soll-Einträge mit Prüfergebnis</caption>
            <thead className="text-left text-ink-400"><tr><th className="py-1 pr-3">Typ</th><th className="pr-3">Name (beim Anbieter)</th><th className="pr-3">Wert</th><th className="pr-3">Zweck</th><th>Prüfung</th></tr></thead>
            <tbody>
              {desired.map((r) => {
                const c = checks.get(`${r.type} ${r.name}`);
                return (
                  <tr key={`${r.type}-${r.name}`} className="border-t border-ink-100 align-top dark:border-white/10">
                    <td className="py-2 pr-3 font-mono">{r.type}</td>
                    <td className="pr-3"><span className="font-mono">{relativeName(r.name, zone)}</span> <CopyButton text={relativeName(r.name, zone)} label="Kopieren" /></td>
                    <td className="max-w-md pr-3"><span className="break-all font-mono">{r.value}</span> <CopyButton text={r.value} label="Kopieren" /></td>
                    <td className="pr-3 text-ink-600 dark:text-ink-200">{PURPOSE[r.purpose] ?? r.purpose}</td>
                    <td>
                      {c ? (
                        <div>
                          <Badge tone={REC_TONE[c.status]}>{REC_LABEL[c.status]}</Badge>
                          <span className="ml-2 text-xs text-ink-400">{c.okResolvers}/{c.totalResolvers} Resolver</span>
                          {c.status === "wrong" && <div className="mt-1 break-all text-xs text-ink-400">gefunden: {c.found.join(", ")}</div>}
                        </div>
                      ) : (
                        <span className="text-ink-400">noch nicht geprüft</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-400">Hinweis: Manche Anbieter erwarten den Namen ohne Domain (wie angezeigt), andere den vollständigen Namen ({desired[0]?.name}). „@“ steht für die Domain selbst.</p>
      </Card>

      {provider.api && (
        <Card title={`Automatisch per API (${provider.name})`}>
          <ApiSetup
            provider={provider.name}
            fields={provider.apiFields ?? []}
            help={provider.apiHelp}
            preview={previewApiAction.bind(null, slug, d.id)}
            apply={applyApiAction.bind(null, slug, d.id)}
            hasStored={Boolean(d.providerCredentials)}
          />
          {d.providerCredentials && (
            <StateForm action={forgetCredentialsAction.bind(null, slug, d.id)} inline>
              <Submit variant="ghost">Gespeicherte Zugangsdaten löschen</Submit>
            </StateForm>
          )}
        </Card>
      )}

      {provider.domainConnect && d.purpose === "landing" && (
        <Card title="Mit einem Klick beim Anbieter (Domain Connect)">
          <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Sie bestätigen die Einträge direkt in Ihrem {provider.name}-Konto – ohne Zugangsdaten hier einzugeben. Funktioniert, sobald unser Domain-Connect-Template beim Anbieter freigeschaltet ist.</p>
          <DomainConnectButton action={domainConnectAction.bind(null, slug, d.id)} />
        </Card>
      )}

      <Card title="Souverän: DNS-Verwaltung zu STACKIT umziehen">
        <StackitMigration
          slug={slug}
          domainId={d.id}
          zone={zone}
          provider={provider}
          available={platformAvailable()}
          migration={migrationOf(d)}
          delegation={(rep as { delegation?: { ok: boolean; found: string[]; okResolvers: number; total: number } } | null)?.delegation}
          managed={d.method === "stackit_managed"}
          canExport={hasSpecial(access, "export")}
        />
      </Card>

      <Card title={`Manuell einrichten – ${guide.title}`}>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px]">
          {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        {guide.note && <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">{guide.note}</p>}
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">Nach dem Speichern „Jetzt prüfen“ wählen – wir prüfen danach automatisch weiter (bis zu 48 Stunden) und aktivieren die Domain, sobald alles stimmt.</p>
      </Card>

      <Card title="Domain entfernen">
        <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">Die Auslieferung unter dieser Adresse endet. DNS-Einträge beim Anbieter löschen wir nicht automatisch – bitte dort selbst entfernen.</p>
        <StateForm action={removeDomainAction.bind(null, slug, d.id)} inline>
          <Submit variant="danger" confirm={`${d.hostname} wirklich entfernen?`}>Entfernen</Submit>
        </StateForm>
      </Card>
    </div>
  );
}

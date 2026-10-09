import { Badge } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { inputCls, labelCls } from "@/components/ui";
import type { ProviderInfo } from "@/lib/domains/catalog";
import { nameserverGuide } from "@/lib/domains/guides";
import { relativeName } from "@/lib/domains/hostname";
import type { Migration } from "@/lib/domains/stackit-migration";
import { STACKIT_NAMESERVERS } from "@/lib/domains/providers/stackit";
import { applyStackitAction, prepareStackitAction, saveStackitSelectionAction } from "./actions";

type Delegation = { ok: boolean; found: string[]; okResolvers: number; total: number } | undefined;

/** Umzug der DNS-Verwaltung zu STACKIT DNS: Bestand → Auswahl → Übertragen → Nameserver umstellen → Delegation. */
export function StackitMigration(props: {
  slug: string;
  domainId: string;
  zone: string;
  provider: ProviderInfo;
  available: boolean;
  migration: Migration | null;
  delegation: Delegation;
  managed: boolean;
  canExport: boolean;
}) {
  const { slug, domainId, zone, provider, available, migration: m, delegation, managed } = props;

  if (provider.key === "stackit") {
    return <p className="text-[15px]">Die Zone liegt bereits bei STACKIT DNS. Einträge werden automatisch über die Plattform gepflegt.</p>;
  }
  if (!available) {
    return (
      <p className="text-[15px] text-ink-600 dark:text-ink-200">
        Souveräne Alternative: Die gesamte DNS-Verwaltung zu STACKIT DNS (Rechenzentren in Deutschland) umziehen – danach pflegt die Plattform alle Einträge automatisch, bei jedem Anbieter.
        Diese Funktion ist auf dieser Plattform noch nicht eingerichtet (Betreiber: STACKIT-Projekt und Service Account hinterlegen).
      </p>
    );
  }

  return (
    <div className="space-y-5 text-[15px]">
      <p className="text-ink-600 dark:text-ink-200">
        Die DNS-Verwaltung von <strong>{zone}</strong> zu STACKIT DNS umziehen (Rechenzentren in Deutschland, verwaltet durch die Plattform). Danach brauchen weitere Einträge – Landingpages, Mail – keine Zugangsdaten mehr.
        Die Domain bleibt bei Ihrem Registrar ({provider.name}); nur die Nameserver werden umgestellt. Rückweg jederzeit über die Zonendatei.
      </p>

      {/* 1 · Bestand erfassen */}
      <section>
        <h3 className="mb-2 font-semibold">1 · Bestehende Einträge erfassen</h3>
        <StateForm action={prepareStackitAction.bind(null, slug, domainId)}>
          {provider.api && !provider.platformManaged && (provider.apiFields ?? []).length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              <p className="md:col-span-2 text-sm text-ink-600 dark:text-ink-200">Optional: Mit Zugangsdaten bei {provider.name} lesen wir die Zone vollständig (empfohlen). Ohne Zugangsdaten fragen wir bekannte Namen per DNS ab. Die Zugangsdaten werden nicht gespeichert.</p>
              {(provider.apiFields ?? []).map((f) => (
                <label key={f.key} className="block">
                  <span className={labelCls}>{f.label}</span>
                  <input name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" className={inputCls} />
                </label>
              ))}
            </div>
          )}
          <Submit variant="ghost">{m ? "Bestand neu erfassen" : "Bestand erfassen"}</Submit>
        </StateForm>
      </section>

      {/* 2 · Prüfen & ergänzen */}
      {m && (
        <section>
          <h3 className="mb-2 font-semibold">2 · Prüfen und ergänzen</h3>
          {m.warnings.map((w, i) => (
            <p key={i} role="note" className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-100">{w}</p>
          ))}
          <StateForm action={saveStackitSelectionAction.bind(null, slug, domainId)}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Übernahme-Liste</caption>
                <thead className="text-left text-ink-400">
                  <tr><th className="py-1 pr-2">Übernehmen</th><th className="pr-3">Typ</th><th className="pr-3">Name</th><th className="pr-3">Wert(e)</th><th>Quelle</th></tr>
                </thead>
                <tbody>
                  {m.items.map((it) => {
                    const key = `${it.type} ${it.name}`;
                    return (
                      <tr key={key} className="border-t border-ink-100 align-top dark:border-white/10">
                        <td className="py-2 pr-2">
                          <input type="checkbox" name="include" value={key} defaultChecked={it.include} disabled={Boolean(m.appliedAt)} aria-label={`${key} übernehmen`} />
                        </td>
                        <td className="pr-3 font-mono">{it.type}</td>
                        <td className="pr-3 font-mono">{relativeName(it.name, zone)}</td>
                        <td className="max-w-md pr-3 font-mono break-all">{it.values.join(" · ")}{it.note && <div className="mt-0.5 font-sans text-xs text-ink-400">{it.note}</div>}</td>
                        <td className="text-ink-400">{it.source === "api" ? "Anbieter-API" : it.source === "dns" ? "DNS" : "manuell"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!m.appliedAt && (
              <>
                <label className="block">
                  <span className={labelCls}>Fehlende Einträge ergänzen (je Zeile „name TYP wert“, z. B. „intern A 203.0.113.10“ oder „@ TXT v=spf1 …“)</span>
                  <textarea name="manual" rows={4} className={`${inputCls} font-mono`} />
                </label>
                <Submit variant="ghost">Auswahl speichern</Submit>
              </>
            )}
          </StateForm>
        </section>
      )}

      {/* 3 · Übertragen */}
      {m && !m.appliedAt && (
        <section>
          <h3 className="mb-2 font-semibold">3 · Zu STACKIT übertragen</h3>
          <StateForm action={applyStackitAction.bind(null, slug, domainId)}>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirm" className="mt-1" />
              <span>Ich habe die Liste geprüft. Alle benötigten Einträge (insbesondere E-Mail: MX, SPF, DKIM) sind ausgewählt oder ergänzt.</span>
            </label>
            <Submit>Zone anlegen und Einträge übertragen</Submit>
          </StateForm>
        </section>
      )}

      {/* 4 · Nameserver umstellen + Delegation */}
      {m?.appliedAt && (
        <section>
          <h3 className="mb-2 font-semibold">4 · Nameserver beim Registrar umstellen</h3>
          <p className="mb-2">
            Übertragen am {new Date(m.appliedAt).toLocaleString("de-DE")} ({m.applied?.length ?? 0} Änderungen). Neue Nameserver:{" "}
            {STACKIT_NAMESERVERS.map((n) => <code key={n} className="mr-2 rounded bg-sand-100 px-1 dark:bg-white/10">{n}</code>)}
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            {nameserverGuide(provider.key).map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="mt-3 flex items-center gap-2">
            Delegation:{" "}
            {delegation ? (
              <Badge tone={delegation.ok ? "ok" : "warn"}>{delegation.ok ? "aktiv – Nameserver zeigen auf STACKIT" : `noch nicht (${delegation.okResolvers}/${delegation.total} Resolver)`}</Badge>
            ) : (
              <Badge tone="neutral">noch nicht geprüft</Badge>
            )}
            {delegation && !delegation.ok && delegation.found.length > 0 && <span className="text-xs text-ink-400">gefunden: {delegation.found.join(", ")}</span>}
          </p>
          {managed && <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">„Jetzt prüfen“ oben startet die Prüfung sofort; danach prüfen wir automatisch weiter.</p>}
        </section>
      )}

      {props.canExport && (m || managed) && (
        <p>
          <a className="text-sm font-medium text-accent-500 underline dark:text-accent-100" href={`/sa/${slug}/domains/${domainId}/zonendatei`}>Zonendatei (BIND) herunterladen</a>
          <span className="ml-2 text-xs text-ink-400">für den Rückweg oder einen anderen Anbieter</span>
        </p>
      )}
    </div>
  );
}

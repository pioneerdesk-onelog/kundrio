import { db } from "@/lib/db";
import { Badge, Card } from "@/components/ui";
import { AutoRefresh } from "@/components/lists/AutoRefresh";
import { RowAction } from "@/components/users/RowAction";
import { StateForm, Submit } from "@/components/users/StateForm";
import { fieldLabel } from "@/lib/enrich/suggestions";
import type { CompanyProfile } from "@/lib/enrich/profile";
import { personEnrichmentBlocked } from "@/lib/enrich/persons-rules";
import { art14InformedAt } from "@/lib/enrich/art14";
import { acceptAll, decideSuggestion, markInformed, startEnrichment } from "@/app/(admin)/sa/[slug]/anreicherung/actions";
import { SocialLinks } from "./SocialLinks";

// Karte „Öffentliche Daten“ für Unternehmens- und Kontakt-Detailseiten.
// Einbau: <EnrichmentCard slug={slug} workspaceId={ws.id} objectType="company" objectId={company.id} canEdit={…} />

type Props = { slug: string; workspaceId: string; objectType: "company" | "contact"; objectId: string; canEdit: boolean };

const SOURCE_LABEL: Record<string, string> = { website: "Website", impressum: "Impressum", searxng: "Websuche", ai: "KI (lokal/EU)" };
const fmtDate = (d: Date | string) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));

function showValue(field: string, v: unknown) {
  if (field === "profile") {
    const p = v as CompanyProfile;
    return p.summary?.value ?? p.industry?.value ?? "KI-Profil";
  }
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export async function EnrichmentCard({ slug, workspaceId, objectType, objectId, canEdit }: Props) {
  const [suggestions, last, pending, record, ws] = await Promise.all([
    db.enrichmentSuggestion.findMany({ where: { workspaceId, objectType, objectId, status: "proposed" }, orderBy: [{ field: "asc" }, { createdAt: "desc" }] }),
    db.appSetting.findUnique({ where: { key: `enrich:last:${objectType}:${objectId}` } }),
    db.job.findFirst({ where: { type: `enrich.${objectType}`, status: { in: ["queued", "running"] }, payload: { path: ["objectId"], equals: objectId } }, select: { status: true } }),
    objectType === "company"
      ? db.company.findFirst({ where: { id: objectId, workspaceId }, select: { socialLinks: true, profile: true, enrichedAt: true } })
      : db.contact.findFirst({ where: { id: objectId, workspaceId }, select: { socialLinks: true, enrichedAt: true, tags: true } }),
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { enrichPersons: true } }),
  ]);
  if (!record) return null;
  const lastRun = last?.value as { at: string; ok: boolean; pages: string[]; suggestions: number; notes: string[]; error?: string } | undefined;
  const social = (record.socialLinks ?? {}) as Record<string, string>;
  const profile = objectType === "company" ? ((record as { profile: unknown }).profile as CompanyProfile | null) : null;
  const blocked = objectType === "contact" ? personEnrichmentBlocked(ws, record as { tags: string[] }) : null;
  const informedAt = objectType === "contact" ? await art14InformedAt(workspaceId, objectId) : null;

  return (
    <Card title="Öffentliche Daten">
      <AutoRefresh active={Boolean(pending)} />
      <p className="mb-3 text-sm text-ink-600 dark:text-ink-200">
        {objectType === "company"
          ? "Aus der Website des Unternehmens (inkl. Impressum) und der eigenen Suchmaschine. Jeder Wert ist ein Vorschlag mit Quelle – übernommen wird erst nach Ihrer Prüfung."
          : "Nur berufliche Angaben: Funktion von der Firmen-Website und Links zu öffentlichen beruflichen Profilen. Keine Profilinhalte, keine privaten Netzwerke."}
      </p>

      {objectType === "contact" && (
        <div className="mb-3 rounded-md border border-ink-100 bg-sand-50 p-3 text-sm dark:border-white/10 dark:bg-white/5">
          {blocked ? (
            <p>{blocked}</p>
          ) : (
            <>
              <p>
                <strong>Informationspflicht (Art. 14 DSGVO):</strong>{" "}
                {informedAt ? `informiert am ${fmtDate(informedAt)}` : "noch nicht vermerkt – die Person ist innerhalb eines Monats zu informieren (Vorlage unter „Anreicherung“)."}
              </p>
              {canEdit && !informedAt && (
                <StateForm action={markInformed.bind(null, slug, objectId)} inline>
                  <select name="how" aria-label="Wie informiert?" className="rounded-md border border-ink-200 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-ink-900">
                    <option>E-Mail</option>
                    <option>Brief</option>
                    <option>persönlich</option>
                  </select>
                  <Submit variant="ghost">Als informiert vermerken</Submit>
                </StateForm>
              )}
            </>
          )}
        </div>
      )}

      {Object.keys(social).length > 0 && (
        <div className="mb-3">
          <SocialLinks links={social} />
        </div>
      )}

      {profile && (
        <div className="mb-4 space-y-1 text-[15px]">
          {profile.summary && <p>{profile.summary.value}</p>}
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            {profile.industry && (
              <>
                <dt className="text-ink-400">Branche</dt>
                <dd>
                  {profile.industry.value} <SourceLink url={profile.industry.source} />
                </dd>
              </>
            )}
            {profile.targetGroup && (
              <>
                <dt className="text-ink-400">Zielgruppe</dt>
                <dd>
                  {profile.targetGroup.value} <SourceLink url={profile.targetGroup.source} />
                </dd>
              </>
            )}
            {profile.sizeHint && (
              <>
                <dt className="text-ink-400">Größe</dt>
                <dd>
                  {profile.sizeHint.value} <SourceLink url={profile.sizeHint.source} />
                </dd>
              </>
            )}
            {!!profile.offer?.length && (
              <>
                <dt className="text-ink-400">Angebot</dt>
                <dd>
                  <ul className="list-disc pl-5">
                    {profile.offer.map((o, i) => (
                      <li key={i}>
                        {o.value} <SourceLink url={o.source} />
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
          <p className="text-xs text-ink-400">KI-unterstützt erstellt aus den verlinkten Quellen.</p>
        </div>
      )}

      {suggestions.length > 0 ? (
        <div className="mb-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Vorschläge ({suggestions.length})</h3>
            {canEdit && suggestions.length > 1 && <RowAction action={acceptAll.bind(null, slug, objectType, objectId)} label="Alle übernehmen" confirm="Alle Vorschläge übernehmen?" />}
          </div>
          <ul className="divide-y divide-ink-100 dark:divide-white/10">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-ink-400">{fieldLabel(objectType, s.field)}</div>
                  <div className="break-words whitespace-pre-line">{showValue(s.field, s.value)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                    <Badge tone="neutral">{SOURCE_LABEL[s.sourceKind] ?? s.sourceKind}</Badge>
                    {s.confidence != null && <span>Sicherheit {Math.round(s.confidence * 100)} %</span>}
                    <span>{fmtDate(s.createdAt)}</span>
                    {s.sourceUrl && <SourceLink url={s.sourceUrl} label="Quelle" />}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <RowAction action={decideSuggestion.bind(null, slug, s.id, "accept")} label="Übernehmen" variant="primary" />
                    <RowAction action={decideSuggestion.bind(null, slug, s.id, "reject")} label="Verwerfen" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mb-3 text-sm text-ink-400">Keine offenen Vorschläge.</p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-3 text-sm dark:border-white/10">
        {canEdit && !blocked && <RowAction action={startEnrichment.bind(null, slug, objectType, objectId)} label={pending ? "Abruf läuft …" : "Öffentliche Daten abrufen"} variant="ghost" />}
        {pending && <Badge tone="accent">{pending.status === "running" ? "läuft" : "wartet auf Worker"}</Badge>}
        {lastRun && (
          <span className="text-ink-400">
            Letzter Abruf {fmtDate(lastRun.at)}: {lastRun.error ? <span className="text-red-700 dark:text-red-300">Fehler – {lastRun.error}</span> : `${lastRun.pages.length} Seiten, ${lastRun.suggestions} neue Vorschläge`}
          </span>
        )}
        {record.enrichedAt && <span className="text-ink-400">Zuletzt übernommen {fmtDate(record.enrichedAt)}</span>}
      </div>
      {lastRun?.notes?.length ? (
        <details className="mt-2 text-xs text-ink-400">
          <summary>Hinweise zum letzten Abruf ({lastRun.notes.length})</summary>
          <ul className="list-disc pl-5">
            {lastRun.notes.slice(0, 10).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function SourceLink({ url, label = "↗" }: { url: string; label?: string }) {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-500 underline-offset-2 hover:underline dark:text-accent-100" title={url}>
      {label === "↗" ? `${host} ↗` : label}
    </a>
  );
}

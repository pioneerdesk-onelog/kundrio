import { Check, Globe, PenLine, Upload, X } from "lucide-react";
import type { Workspace } from "@prisma/client";
import { db } from "@/lib/db";
import { Badge, btnCls, btnGhostCls } from "@/components/ui";
import { ACCEPT_ATTR } from "@/lib/storage";
import { getBrandStatus, openBrandSuggestions } from "@/lib/brand/suggestions";
import { matchAppFont, parseGuide, SUGGESTION_FIELDS, COLOR_ROLE_LABELS, type BrandGuide, type SuggestionField } from "@/lib/brand/guide";
import { contrastRatio, onColor } from "@/lib/p-a11y";
import { fontStack } from "@/components/blocks/types";
import { AutoRefresh } from "@/components/lists/AutoRefresh";
import {
  acceptAllSuggestions,
  acceptSuggestion,
  deleteBrandFile,
  rejectSuggestion,
  saveBrandManual,
  startBrandbookExtraction,
  startWebsiteExtraction,
} from "@/app/(admin)/sa/[slug]/einstellungen/brand-actions";
import { BrandUpload } from "./BrandUpload";
import { ManualForm, WebsiteForm } from "./BrandForms";

// Abschnitt „Marke & CI“ in den Einstellungen: drei Wege (Dokumente, Website, manuell) → Vorschläge → Leitfaden.

const KIND_LABEL: Record<string, string> = { brandbook: "Brandbook", website: "Website", manual: "manuell" };

function Swatch({ hex, label }: { hex: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-4 w-4 rounded border border-black/10" style={{ background: hex }} aria-hidden />
      <span className="font-mono text-xs">{hex}</span>
      {label && <span className="text-xs text-ink-400">{label}</span>}
    </span>
  );
}

function SuggestionValue({ field, value }: { field: SuggestionField; value: Record<string, unknown> }) {
  if (field === "brandPrimary" || field === "brandAccent") {
    const c = value as { hex: string; reason?: string; contrastWhite?: number };
    return (
      <span className="space-y-0.5">
        <Swatch hex={c.hex} />
        <span className="block text-xs text-ink-400 dark:text-ink-200">
          {c.reason}
          {typeof c.contrastWhite === "number" && ` · Kontrast zu Weiß ${c.contrastWhite}:1${c.contrastWhite < 4.5 ? " (unter 4,5 – für Text auf Weiß ungeeignet)" : ""}`}
        </span>
      </span>
    );
  }
  if (field === "fontHeading" || field === "fontBody") {
    const font = String(value.font ?? "");
    return (
      <span>
        {font} {!matchAppFont(font) && <span className="text-xs text-ink-400">(nicht lokal eingebunden – wird nur im Leitfaden vermerkt)</span>}
      </span>
    );
  }
  if (field === "logoSvg") {
    return (
      // Bereinigtes SVG als Bild-Datenquelle (Skripte wirkungslos)
      // eslint-disable-next-line @next/next/no-img-element
      <img alt="Logo-Vorschlag" className="h-10 max-w-[200px] rounded border border-ink-100 bg-white p-1" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(value.svg ?? ""))}`} />
    );
  }
  if (field === "logoFile") return <span>Bild „{String(value.name ?? "")}“</span>;
  const data = value.data as unknown;
  if (field === "guide.colors" && Array.isArray(data)) {
    return (
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        {(data as { hex: string; name: string; role: keyof typeof COLOR_ROLE_LABELS; approx?: boolean }[]).map((c) => (
          <Swatch key={c.hex} hex={c.hex} label={`${c.name || COLOR_ROLE_LABELS[c.role] || ""}${c.approx ? " ≈" : ""}`} />
        ))}
      </span>
    );
  }
  if (field === "guide.voice") {
    const v = data as { summary: string; adjectives: string[] };
    return <span>{v.summary}{v.adjectives?.length ? ` (${v.adjectives.join(", ")})` : ""}</span>;
  }
  if (field === "guide.doAndDont") {
    const d = data as { do: { text: string }[]; dont: { text: string }[] };
    return (
      <span className="block text-sm">
        {d.do.length > 0 && <span className="block">✓ {d.do.map((x) => x.text).join(" · ")}</span>}
        {d.dont.length > 0 && <span className="block">✗ {d.dont.map((x) => x.text).join(" · ")}</span>}
      </span>
    );
  }
  if (field === "guide.writingRules") {
    const w = data as { address: string; gender?: string; terms: string[] };
    return <span>Anrede: {w.address === "du" ? "Du" : w.address === "sie" ? "Sie" : "offen"}{w.gender ? ` · Gendern: ${w.gender}` : ""}{w.terms?.length ? ` · ${w.terms.join(", ")}` : ""}</span>;
  }
  if (Array.isArray(data)) return <span>{(data as (string | { text: string })[]).map((x) => (typeof x === "string" ? x : x.text)).join(" · ")}</span>;
  if (data && typeof data === "object") {
    const t = data as { heading?: string; body?: string; googleFonts?: string[]; notes?: string };
    return <span>{[t.heading && `Überschriften: ${t.heading}`, t.body && `Text: ${t.body}`, t.googleFonts?.length && `Google Fonts: ${t.googleFonts.join(", ")}`, t.notes].filter(Boolean).join(" · ")}</span>;
  }
  return <span>{JSON.stringify(value).slice(0, 200)}</span>;
}

/** Vorschau im (übernommenen) Stil: Button, Überschrift, E-Mail-Kopf, Landingpage-Hero. */
function Preview({ ws, guide }: { ws: Workspace; guide: BrandGuide }) {
  const p = ws.brandPrimary;
  const a = ws.brandAccent;
  const onP = onColor(p);
  const ratio = contrastRatio(p, "#ffffff");
  const logo = ws.logoSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ws.logoSvg)}` : null;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-ink-100 dark:border-white/10" style={{ fontFamily: fontStack(ws.fontBody) }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: p, color: onP }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-7 max-w-[120px] rounded bg-white/90 p-0.5" src={logo} />
          ) : (
            <span className="font-semibold">{ws.name}</span>
          )}
          <span className="text-sm opacity-90">E-Mail-Kopf</span>
        </div>
        <div className="space-y-3 bg-white px-5 py-6 text-[#1f2a37]">
          <p className="text-2xl" style={{ fontFamily: fontStack(ws.fontHeading), color: "#0e141b" }}>Überschrift im Markenstil</p>
          <p className="text-[15px]">{guide.voice?.summary ?? "Hier steht Fließtext in der Hausschrift. Pflegen Sie die Markenstimme, damit KI-Texte passend klingen."}</p>
          <div className="flex gap-2">
            <span className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: p, color: onP }}>Beispiel-Button</span>
            <span className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: a, color: onColor(a) }}>Akzent</span>
          </div>
        </div>
      </div>
      <p className="text-sm text-ink-400 dark:text-ink-200">
        Kontrast Primärfarbe zu Weiß: {ratio ? `${ratio.toFixed(2)}:1` : "–"}
        {ratio !== null && ratio < 4.5 ? " – für weiße Schrift auf der Primärfarbe zu gering (WCAG AA verlangt 4,5:1)." : " ✓"}
      </p>
    </div>
  );
}

export async function BrandSection({ slug, ws, canEdit }: { slug: string; ws: Workspace; canEdit: boolean }) {
  const [files, suggestions, status] = await Promise.all([
    db.storedFile.findMany({ where: { workspaceId: ws.id, kind: { in: ["brandbook", "logo"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    openBrandSuggestions(ws.id),
    getBrandStatus(ws.id),
  ]);
  const guide = parseGuide(ws.brandGuide);
  const running = status?.state === "queued" || status?.state === "running";

  return (
    <div className="space-y-6">
      <AutoRefresh active={running} ms={3000} />
      {canEdit && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-ink-100 p-4 dark:border-white/10">
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><Upload size={17} aria-hidden /> Dokumente hochladen</h3>
            <BrandUpload
              slug={slug}
              accept={ACCEPT_ATTR}
              files={files.map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, kind: f.kind, createdAt: f.createdAt.toISOString() }))}
              start={startBrandbookExtraction.bind(null, slug)}
              remove={deleteBrandFile.bind(null, slug)}
            />
          </div>
          <div className="rounded-lg border border-ink-100 p-4 dark:border-white/10">
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><Globe size={17} aria-hidden /> Website auswerten</h3>
            <WebsiteForm action={startWebsiteExtraction.bind(null, slug)} domain={ws.domain} />
          </div>
          <details className="rounded-lg border border-ink-100 p-4 lg:col-span-2 dark:border-white/10" open={!guide.voice && !guide.colors?.length}>
            <summary className="mb-3 flex cursor-pointer items-center gap-2 font-semibold"><PenLine size={17} aria-hidden /> Manuell pflegen</summary>
            <ManualForm action={saveBrandManual.bind(null, slug)} guide={guide} />
          </details>
        </div>
      )}

      {status && (
        <p role="status" className="text-sm">
          <Badge tone={status.state === "failed" ? "bad" : running ? "warn" : "ok"}>
            {status.mode === "website" ? "Website" : "Dokumente"}: {status.state === "queued" ? "in Warteschlange" : status.state === "running" ? "läuft" : status.state === "done" ? "fertig" : "fehlgeschlagen"}
          </Badge>{" "}
          {status.message}
          {status.state === "done" && typeof status.created === "number" && ` ${status.created} Vorschläge.`}
          {running && " (Hintergrund-Worker muss laufen: npm run worker)"}
        </p>
      )}

      {suggestions.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Vorschläge ({suggestions.length})</h3>
            {canEdit && (
              <form action={acceptAllSuggestions.bind(null, slug)}>
                <button className={btnGhostCls}><Check size={15} aria-hidden /> Alle übernehmen (je Feld der neueste)</button>
              </form>
            )}
          </div>
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100 dark:divide-white/10 dark:border-white/10">
            {suggestions.map((s) => {
              const field = s.field as SuggestionField;
              return (
                <li key={s.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{SUGGESTION_FIELDS[field] ?? s.field}</span>
                      <Badge tone="neutral">{KIND_LABEL[s.sourceKind] ?? s.sourceKind}</Badge>
                      {s.confidence !== null && <span className="text-xs text-ink-400">Sicherheit {Math.round(s.confidence * 100)} %</span>}
                    </div>
                    <div className="text-[15px]"><SuggestionValue field={field} value={s.value as Record<string, unknown>} /></div>
                    <div className="truncate text-xs text-ink-400 dark:text-ink-200" title={s.sourceUrl ?? ""}>
                      Quelle: {s.sourceUrl ?? "–"} · {s.createdAt.toLocaleString("de-DE")}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-2">
                      <form action={acceptSuggestion.bind(null, slug, s.id)}>
                        <button className={btnCls} aria-label={`${SUGGESTION_FIELDS[field] ?? s.field} übernehmen`}><Check size={15} aria-hidden /> Übernehmen</button>
                      </form>
                      <form action={rejectSuggestion.bind(null, slug, s.id)}>
                        <button className={btnGhostCls} aria-label={`${SUGGESTION_FIELDS[field] ?? s.field} verwerfen`}><X size={15} aria-hidden /> Verwerfen</button>
                      </form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">Vorschau</h3>
          <Preview ws={ws} guide={guide} />
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Markenleitfaden</h3>
          {!guide.voice && !guide.colors?.length && !guide.doAndDont ? (
            <p className="text-ink-400 dark:text-ink-200">Noch kein Leitfaden gepflegt. Laden Sie ein Brandbook hoch, werten Sie die Website aus oder pflegen Sie ihn manuell.</p>
          ) : (
            <dl className="space-y-2 text-[15px]">
              {guide.colors?.length ? (
                <div><dt className="text-sm text-ink-400">Farben</dt><dd className="flex flex-wrap gap-x-3 gap-y-1">{guide.colors.map((c) => <Swatch key={c.hex + c.name} hex={c.hex} label={c.name || COLOR_ROLE_LABELS[c.role]} />)}</dd></div>
              ) : null}
              {guide.typography && (guide.typography.heading || guide.typography.body) && (
                <div><dt className="text-sm text-ink-400">Typografie</dt><dd>{[guide.typography.heading, guide.typography.body].filter(Boolean).join(" / ")}</dd></div>
              )}
              {guide.voice && <div><dt className="text-sm text-ink-400">Markenstimme</dt><dd>{guide.voice.summary}</dd></div>}
              {guide.writingRules && guide.writingRules.address !== "unklar" && <div><dt className="text-sm text-ink-400">Anrede</dt><dd>{guide.writingRules.address === "du" ? "Du" : "Sie"}{guide.writingRules.gender ? ` · ${guide.writingRules.gender}` : ""}</dd></div>}
              {guide.doAndDont && (guide.doAndDont.do.length || guide.doAndDont.dont.length) ? (
                <div><dt className="text-sm text-ink-400">Do&apos;s &amp; Don&apos;ts</dt><dd className="text-sm">{guide.doAndDont.do.map((d) => `✓ ${d.text}`).concat(guide.doAndDont.dont.map((d) => `✗ ${d.text}`)).join(" · ")}</dd></div>
              ) : null}
              {guide.sources?.length ? <div className="text-xs text-ink-400">Zuletzt: {guide.sources.at(-1)?.kind} · {new Date(guide.sources.at(-1)!.at).toLocaleString("de-DE")}</div> : null}
            </dl>
          )}
          <p className="mt-3 text-sm text-ink-400 dark:text-ink-200">Die Markenstimme fließt als Stilvorgabe in KI-Texte (Landingpage-Entwürfe, Übersetzungen, Wiki-Vorschläge) ein – Fakten bleiben quellengebunden.</p>
        </div>
      </div>
    </div>
  );
}

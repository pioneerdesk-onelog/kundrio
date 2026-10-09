"use client";

import { useMemo, useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, btnGhostCls, Empty, inputCls } from "@/components/ui";
import { markMention } from "@/app/(admin)/sa/[slug]/erwaehnungen/actions";

export type MentionItem = {
  id: string;
  url: string;
  title: string;
  sourceHost: string | null;
  sourceKind: string;
  publishedAt: string | null;
  createdAt: string;
  snippet: string | null;
  summary: string | null;
  sentiment: string | null;
  relevance: number | null;
  topics: string[];
  status: string;
  objectLabel?: string | null;
  objectHref?: string | null;
};

const SOURCE: Record<string, string> = { gdelt: "GDELT", searxng: "Websuche", website: "Firmen-Website", rss: "Firmen-Feed" };
const STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "bad" | "accent" }> = {
  new: { label: "neu", tone: "accent" },
  relevant: { label: "relevant", tone: "ok" },
  irrelevant: { label: "irrelevant", tone: "neutral" },
};
const TONE: Record<string, "ok" | "neutral" | "bad"> = { positiv: "ok", neutral: "neutral", negativ: "bad" };

function fmt(d: string | null) {
  if (!d) return "Datum unbekannt";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(d));
}

/** Zeitleiste der Erwähnungen mit Filtern und Markieren. */
export function MentionList({
  slug,
  items,
  canEdit,
  showObject = false,
  initialStatus = "aktiv",
}: {
  slug: string;
  items: MentionItem[];
  canEdit: boolean;
  showObject?: boolean;
  initialStatus?: string;
}) {
  const [status, setStatus] = useState<string>(initialStatus);
  const [topic, setTopic] = useState<string>("");
  const [local, setLocal] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const topics = useMemo(() => Array.from(new Set(items.flatMap((i) => i.topics))).sort(), [items]);

  const shown = items.filter((i) => {
    const st = local[i.id] ?? i.status;
    if (status === "aktiv" && st === "irrelevant") return false;
    if (status !== "aktiv" && status !== "alle" && st !== status) return false;
    if (topic && !i.topics.includes(topic)) return false;
    return true;
  });

  const mark = (id: string, s: string) =>
    start(async () => {
      const r = await markMention(slug, id, s);
      if (r.error) setMsg(r.error);
      else {
        setLocal((l) => ({ ...l, [id]: s }));
        setMsg(null);
      }
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="text-sm">
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} w-auto`} aria-label="Status filtern">
            <option value="aktiv">neu + relevant</option>
            <option value="new">nur neu</option>
            <option value="relevant">nur relevant</option>
            <option value="irrelevant">irrelevant</option>
            <option value="alle">alle</option>
          </select>
        </label>
        {topics.length > 0 && (
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className={`${inputCls} w-auto`} aria-label="Thema filtern">
            <option value="">alle Themen</option>
            {topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {msg && (
        <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">
          {msg}
        </p>
      )}
      {shown.length === 0 ? (
        <Empty>Keine Erwähnungen{items.length ? " für diesen Filter" : ""}.</Empty>
      ) : (
        <ol className="space-y-3" aria-busy={pending}>
          {shown.map((i) => {
            const st = local[i.id] ?? i.status;
            return (
              <li key={i.id} className="rounded-lg border border-ink-100 p-3 dark:border-white/10">
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-400 dark:text-ink-200">
                  <time dateTime={i.publishedAt ?? undefined}>{fmt(i.publishedAt)}</time>
                  <span>·</span>
                  <span>{i.sourceHost ?? SOURCE[i.sourceKind] ?? i.sourceKind}</span>
                  <Badge tone="neutral">{SOURCE[i.sourceKind] ?? i.sourceKind}</Badge>
                  <Badge tone={STATUS[st]?.tone ?? "neutral"}>{STATUS[st]?.label ?? st}</Badge>
                  {i.sentiment && <Badge tone={TONE[i.sentiment] ?? "neutral"}>{i.sentiment}</Badge>}
                  {i.topics.map((t) => (
                    <Badge key={t} tone="accent">
                      {t}
                    </Badge>
                  ))}
                </div>
                <a href={i.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-flex items-start gap-1 font-medium text-ink-900 hover:underline dark:text-ink-50">
                  {i.title}
                  <ExternalLink size={14} className="mt-1 shrink-0" aria-hidden />
                  <span className="sr-only">(öffnet externe Seite)</span>
                </a>
                {showObject && i.objectLabel && (
                  <div className="text-sm">
                    {i.objectHref ? (
                      <a href={i.objectHref} className="text-accent-500 hover:underline dark:text-accent-100">
                        {i.objectLabel}
                      </a>
                    ) : (
                      i.objectLabel
                    )}
                  </div>
                )}
                {i.summary ? <p className="mt-1 text-[15px] text-ink-800 dark:text-ink-100">{i.summary}</p> : i.snippet ? <p className="mt-1 text-[15px] text-ink-600 dark:text-ink-200">„{i.snippet}“</p> : null}
                {canEdit && (
                  <div className="mt-2 flex gap-2">
                    {st !== "relevant" && (
                      <button type="button" className={btnGhostCls} onClick={() => mark(i.id, "relevant")} disabled={pending}>
                        Relevant
                      </button>
                    )}
                    {st !== "irrelevant" && (
                      <button type="button" className={btnGhostCls} onClick={() => mark(i.id, "irrelevant")} disabled={pending}>
                        Nicht relevant / Verwechslung
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

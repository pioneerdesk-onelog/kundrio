import { NODE_TYPES } from "@/lib/process/definition";
import { Badge } from "@/components/ui";

export const RUN_STATUS: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "bad" | "accent" }> = {
  running: { label: "läuft", tone: "accent" },
  waiting: { label: "wartet", tone: "warn" },
  done: { label: "fertig", tone: "ok" },
  goal_met: { label: "Ziel erreicht", tone: "ok" },
  failed: { label: "fehlgeschlagen", tone: "bad" },
  cancelled: { label: "abgebrochen", tone: "neutral" },
};

const STEP_STATUS: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "bad" | "accent" }> = {
  ok: { label: "erledigt", tone: "ok" },
  skipped: { label: "übersprungen", tone: "neutral" },
  failed: { label: "Fehler", tone: "bad" },
  waiting: { label: "wartet", tone: "warn" },
  branch: { label: "verzweigt", tone: "accent" },
};

function detailText(d: unknown): string {
  if (d == null) return "";
  if (typeof d === "string") return d;
  try {
    const s = JSON.stringify(d);
    return s.length > 400 ? `${s.slice(0, 399)}…` : s;
  } catch {
    return "";
  }
}

/** Schritt-für-Schritt-Protokoll eines Laufs (Server- und Client-tauglich, ohne Hooks). */
export function RunTimeline({ steps, labels }: { steps: { nodeId: string; nodeType: string; status: string; detail: unknown; createdAt: string | Date }[]; labels?: Record<string, string> }) {
  if (steps.length === 0) return <p className="text-[15px] text-ink-400 dark:text-ink-200">Noch keine Schritte protokolliert.</p>;
  return (
    <ol className="relative space-y-3 border-l-2 border-ink-100 pl-4 dark:border-white/10">
      {steps.map((s, i) => {
        const st = STEP_STATUS[s.status] ?? { label: s.status, tone: "neutral" as const };
        const spec = NODE_TYPES[s.nodeType as keyof typeof NODE_TYPES];
        const t = new Date(s.createdAt);
        return (
          <li key={`${s.nodeId}-${i}`} className="relative">
            <span className={`absolute -left-[23px] top-1.5 h-3 w-3 rounded-full ${s.status === "failed" ? "bg-red-500" : s.status === "ok" ? "bg-emerald-500" : "bg-ink-200"}`} aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-900 dark:text-ink-50">{labels?.[s.nodeId] ?? spec?.label ?? s.nodeType}</span>
              <Badge tone={st.tone}>{st.label}</Badge>
              <time className="text-sm text-ink-400 dark:text-ink-200" dateTime={t.toISOString()}>
                {t.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}
              </time>
            </div>
            {detailText(s.detail) && <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-sand-100 px-2 py-1 font-mono text-xs text-ink-600 dark:bg-white/5 dark:text-ink-100">{detailText(s.detail)}</pre>}
          </li>
        );
      })}
    </ol>
  );
}

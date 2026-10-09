// Gemeinsame UI-Bausteine im Pioneerdesk-Design (Tailwind-Tokens aus globals.css).
import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-[15px] text-ink-900 placeholder:text-ink-400 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100 dark:border-white/15 dark:bg-ink-900 dark:text-ink-50";
export const btnCls =
  "inline-flex items-center gap-1.5 rounded-md bg-accent-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-50";
export const btnGhostCls =
  "inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 transition hover:bg-sand-100 dark:border-white/15 dark:bg-transparent dark:text-ink-50 dark:hover:bg-white/10";
export const btnDangerCls =
  "inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10";
export const labelCls = "mb-1 block text-sm font-medium text-ink-800 dark:text-ink-100";

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-ink-100 bg-white p-5 shadow-[0_1px_2px_rgba(14,20,27,0.04)] dark:border-white/10 dark:bg-ink-900 ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-5 dark:border-white/10 dark:bg-ink-900">
      <div className="text-sm text-ink-400 dark:text-ink-200">{label}</div>
      <div className="mt-1 font-display text-3xl tabular-nums text-ink-900 dark:text-ink-50">{typeof value === "number" ? value.toLocaleString("de-DE") : value}</div>
      {hint && <div className="mt-1 text-sm text-ink-400 dark:text-ink-200">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, children, description }: { title: string; children?: ReactNode; description?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl text-ink-900 dark:text-ink-50">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-ink-600 dark:text-ink-200">{description}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-ink-400 dark:text-ink-200">{children}</p>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-sand-100 text-ink-600 dark:bg-white/10 dark:text-ink-100",
    accent: "bg-accent-50 text-accent-700 dark:bg-accent-500/20 dark:text-accent-100",
    ok: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
    warn: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
    bad: "bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

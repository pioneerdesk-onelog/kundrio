"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { btnGhostCls } from "@/components/ui";
import type { InboxActionState } from "@/app/(admin)/sa/[slug]/posteingang/actions";

/**
 * Tastaturkürzel im Posteingang: j/k = nächstes/vorheriges Gespräch, e = erledigt (klickt den Knopf
 * mit id „pd-close-conversation“). Greift nicht, solange in einem Eingabefeld getippt wird.
 */
export function KeyboardNav({ hrefs, currentIndex }: { hrefs: string[]; currentIndex: number }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" && hrefs.length) {
        e.preventDefault();
        router.push(hrefs[Math.min(hrefs.length - 1, currentIndex + 1)] ?? hrefs[0]);
      } else if (e.key === "k" && hrefs.length) {
        e.preventDefault();
        router.push(hrefs[Math.max(0, currentIndex - 1)] ?? hrefs[0]);
      } else if (e.key === "e") {
        const b = document.getElementById("pd-close-conversation");
        if (b) {
          e.preventDefault();
          b.click();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hrefs, currentIndex, router]);
  return null;
}

/** Beim Öffnen eines Gesprächs als gelesen markieren. */
export function MarkRead({ action }: { action: () => Promise<void> }) {
  useEffect(() => {
    void action();
  }, [action]);
  return null;
}

export function TicketButton({ action, existing }: { action: (prev: InboxActionState) => Promise<InboxActionState>; existing?: string }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run}>
      <button className={btnGhostCls} disabled={Boolean(existing)}>
        {existing ? `Ticket ${existing}` : "In Ticket umwandeln"}
      </button>
      {state.error && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
    </form>
  );
}

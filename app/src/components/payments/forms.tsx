"use client";

import { usePathname } from "next/navigation";
import { createContext, useActionState, useContext, useEffect, useState, type ReactNode } from "react";
import { btnCls, btnDangerCls, btnGhostCls } from "@/components/ui";

export type PayFormState = { error?: string; ok?: string };
type Action = (prev: PayFormState, fd: FormData) => Promise<PayFormState>;

// Gemeinsame Rückmeldung im Layout: bleibt sichtbar, auch wenn das auslösende Formular nach dem Neuladen
// verschwindet (Zeile wandert in eine andere Liste, Vorschlagsliste ist leer …).
const Feedback = createContext<((s: PayFormState) => void) | null>(null);

export function PayFeedbackProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<PayFormState>({});
  const path = usePathname();
  useEffect(() => setMsg({}), [path]); // Tab-Wechsel: alte Meldung weg
  return (
    <Feedback.Provider value={setMsg}>
      <div className="sticky top-0 z-10 empty:hidden">
        {msg.ok && <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-[15px] text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100">{msg.ok}</p>}
        {msg.error && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-[15px] text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100">{msg.error}</p>}
      </div>
      {children}
    </Feedback.Provider>
  );
}

/** Formular mit Rückmeldung (im Layout über PayFeedbackProvider, sonst inline); `id` erlaubt Felder außerhalb (HTML-Attribut form="…", z. B. Sammel-Bestätigung). */
export function PayForm({
  action,
  submit,
  children,
  tone = "primary",
  className = "space-y-3",
  confirm,
  id,
  hideSubmit = false,
}: {
  action: Action;
  submit: string;
  children?: ReactNode;
  tone?: "primary" | "ghost" | "danger";
  className?: string;
  confirm?: string;
  id?: string;
  /** Knopf ausblenden, Rückmeldung aber stehen lassen (z. B. wenn die Liste nach dem Absenden leer ist). */
  hideSubmit?: boolean;
}) {
  const report = useContext(Feedback);
  // Rückmeldung direkt nach der Action ans Layout melden – ein Effekt käme zu spät, wenn das Formular
  // im selben Render verschwindet.
  const [state, run, pending] = useActionState<PayFormState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    report?.(r);
    return r;
  }, {});
  const cls = tone === "ghost" ? btnGhostCls : tone === "danger" ? btnDangerCls : btnCls;
  return (
    <form
      id={id}
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {!hideSubmit && <button className={cls} disabled={pending}>{pending ? "Bitte warten …" : submit}</button>}
      {!report && state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
      {!report && state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
    </form>
  );
}

"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { btnCls, btnDangerCls, btnGhostCls } from "@/components/ui";

export type FormState = { error?: string; ok?: string };

/** Formular mit Inline-Rückmeldung (Fehler/Erfolg) für Server Actions der Form (prev, formData). */
export function StateForm({
  action,
  children,
  className = "space-y-3",
  inline = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={inline ? "flex flex-wrap items-center gap-2" : className}>
      {children}
      {state.error && (
        <p role="alert" className="w-full text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="w-full text-sm text-emerald-700 dark:text-emerald-300">
          {state.ok}
        </p>
      )}
    </form>
  );
}

export function Submit({ children, variant = "primary", confirm }: { children: ReactNode; variant?: "primary" | "ghost" | "danger"; confirm?: string }) {
  const { pending } = useFormStatus();
  const cls = variant === "danger" ? btnDangerCls : variant === "ghost" ? btnGhostCls : btnCls;
  return (
    <button
      type="submit"
      className={cls}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Bitte warten …" : children}
    </button>
  );
}

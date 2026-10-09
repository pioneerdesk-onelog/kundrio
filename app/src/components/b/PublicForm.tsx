"use client";

import { useActionState } from "react";
import type { SubmitState } from "@/app/(public)/f/[id]/actions";
import { btnCls, inputCls } from "@/components/ui";

type Field = { key: string; label: string; type: "text" | "email" | "tel" | "textarea"; required: boolean };

export function PublicForm({
  action,
  fields,
  consentText,
  ts,
}: {
  action: (prev: SubmitState, fd: FormData) => Promise<SubmitState>;
  fields: Field[];
  consentText: string | null;
  /** Signierter Zeitstempel (Ausfüllzeit für die Lead-Echtheit) */
  ts?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as SubmitState);

  if (state.status === "ok") {
    return <p role="status" className="rounded-md bg-green-50 p-4 text-sm text-green-800">{state.message}</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {ts && <input type="hidden" name="_ts" value={ts} />}
      {fields.map((f) => (
        <label key={f.key} className="block text-sm">
          {f.label}
          {f.required && <span className="text-red-600"> *</span>}
          {f.type === "textarea" ? (
            <textarea name={f.key} required={f.required} rows={4} maxLength={5000} className={inputCls} />
          ) : (
            <input
              name={f.key}
              type={f.type}
              required={f.required}
              maxLength={f.type === "email" ? 254 : f.type === "tel" ? 40 : 200}
              autoComplete={f.key === "email" ? "email" : f.key === "firstName" ? "given-name" : f.key === "lastName" ? "family-name" : f.type === "tel" ? "tel" : undefined}
              className={inputCls}
            />
          )}
        </label>
      ))}
      {/* Honeypot: für Menschen unsichtbar */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>
          Website
          <input name="website_url" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {consentText && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" className="mt-1" />
          <span>{consentText}</span>
        </label>
      )}
      {state.status === "error" && <p role="alert" className="text-sm text-red-600">{state.message}</p>}
      <button className={btnCls} disabled={pending}>{pending ? "Wird gesendet …" : "Absenden"}</button>
    </form>
  );
}

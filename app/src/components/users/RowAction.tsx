"use client";

import { StateForm, Submit, type FormState } from "./StateForm";

/** Kleine Ein-Knopf-Aktion mit Inline-Rückmeldung. */
export function RowAction({ action, label, variant = "ghost", confirm }: { action: (p: FormState, fd: FormData) => Promise<FormState>; label: string; variant?: "primary" | "ghost" | "danger"; confirm?: string }) {
  return (
    <StateForm action={action} inline>
      <Submit variant={variant} confirm={confirm}>{label}</Submit>
    </StateForm>
  );
}

/** Auswahlfeld + Speichern. */
export function SelectAction({
  action,
  name,
  options,
  value,
  label,
  disabled,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  name: string;
  options: { value: string; label: string }[];
  value: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <StateForm action={action} inline>
      <select name={name} defaultValue={value} aria-label={label} disabled={disabled} className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-[15px] dark:border-white/15 dark:bg-ink-900">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {!disabled && <Submit variant="ghost">Speichern</Submit>}
    </StateForm>
  );
}

"use client";

import { useActionState, useMemo, useState } from "react";
import { OBJECT_LABELS, OBJECT_TYPES, TRIGGER_TYPES, type ObjectType, type TriggerType } from "@/lib/process/definition";
import { TRIGGER_HELP } from "@/lib/process-ui/help";
import { Badge, btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { FormState } from "@/app/(admin)/sa/[slug]/prozesse/actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Template = { key: string; name: string; description: string; objectType: ObjectType; external: boolean };

/** Leeren Prozess anlegen: Objekt + Auslöser wählen. */
export function NewEmptyProcess({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [objectType, setObjectType] = useState<ObjectType>("contact");
  const triggers = useMemo(
    () => (Object.entries(TRIGGER_TYPES) as [TriggerType, { label: string; objectType: ObjectType | null }][]).filter(([, t]) => !t.objectType || t.objectType === objectType),
    [objectType],
  );
  const [trigger, setTrigger] = useState<TriggerType>("form.submitted");
  const validTrigger = triggers.some(([k]) => k === trigger) ? trigger : triggers[0][0];

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className={labelCls}>Name</span>
        <input name="name" required minLength={2} maxLength={120} className={inputCls} placeholder="z. B. Messe-Leads nachfassen" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Wofür läuft der Prozess?</span>
          <select name="objectType" value={objectType} onChange={(e) => setObjectType(e.target.value as ObjectType)} className={inputCls}>
            {OBJECT_TYPES.map((o) => (
              <option key={o} value={o}>
                {OBJECT_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Auslöser</span>
          <select name="trigger" value={validTrigger} onChange={(e) => setTrigger(e.target.value as TriggerType)} className={inputCls}>
            {triggers.map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {TRIGGER_HELP[validTrigger] && <p className="text-[15px] text-ink-600 dark:text-ink-200">{TRIGGER_HELP[validTrigger]}</p>}
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <button className={btnCls} disabled={pending}>
        {pending ? "Wird angelegt …" : "Leeren Prozess anlegen"}
      </button>
    </form>
  );
}

/** Vorlagen-Galerie mit Best-Practice-Prozessen. */
export function TemplateGallery({ templates, action, error }: { templates: Template[]; action: Action; error?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (error) return <p className="text-[15px] text-ink-600 dark:text-ink-200">Vorlagen sind gerade nicht verfügbar: {error}</p>;
  if (templates.length === 0) return <p className="text-[15px] text-ink-600 dark:text-ink-200">Noch keine Vorlagen vorhanden.</p>;
  return (
    <div>
      {state.error && (
        <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <li key={t.key} className="flex flex-col rounded-lg border border-ink-100 p-4 dark:border-white/10">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink-900 dark:text-ink-50">{t.name}</span>
              <Badge tone="accent">{OBJECT_LABELS[t.objectType]}</Badge>
              {t.external && <Badge tone="warn">Außenwirkung</Badge>}
            </div>
            <p className="mb-3 flex-1 text-[15px] text-ink-600 dark:text-ink-200">{t.description}</p>
            <form action={formAction}>
              <input type="hidden" name="templateKey" value={t.key} />
              <input type="hidden" name="name" value={t.name} />
              <input type="hidden" name="objectType" value={t.objectType} />
              <button className={btnGhostCls} disabled={pending}>
                Als Entwurf übernehmen
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

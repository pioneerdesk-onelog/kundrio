"use client";

import { useActionState } from "react";
import { inputCls } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/c/SubmitButton";
import { addTextSource, addUrlSource, ask, reindexSource, type AskState, type FormState } from "./actions";

export function AddTextForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(addTextSource.bind(null, slug), {} as FormState);
  return (
    <form action={action} className="space-y-2">
      <input name="title" placeholder="Titel" className={inputCls} required maxLength={200} />
      <textarea name="content" placeholder="Inhalt (Text oder Markdown)" rows={6} className={inputCls} required />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="isPublic" className="mt-1" defaultChecked={false} />
        <span>Für KI-Agenten öffentlich <span className="text-ink-400 dark:text-ink-200">(darf über die Agent-Schnittstelle zitiert werden)</span></span>
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton pending="Indiziere …">Text hinzufügen</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function AddUrlForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(addUrlSource.bind(null, slug), {} as FormState);
  return (
    <form action={action} className="space-y-2">
      <input name="url" type="url" placeholder="https://…" className={inputCls} required />
      <input name="title" placeholder="Titel (optional, sonst Seitentitel)" className={inputCls} maxLength={200} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="isPublic" className="mt-1" defaultChecked={true} />
        <span>Für KI-Agenten öffentlich <span className="text-ink-400 dark:text-ink-200">(darf über die Agent-Schnittstelle zitiert werden)</span></span>
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton pending="Abrufen & indizieren …">URL hinzufügen</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ReindexButton({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState(reindexSource.bind(null, slug, id), {} as FormState);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <SubmitButton ghost pending="…">Neu indizieren</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function AskForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(ask.bind(null, slug), {} as AskState);
  return (
    <div className="space-y-3">
      <form action={action} className="flex gap-2">
        <input name="question" placeholder="Frage an die Wissensbasis dieses Sub-Accounts" className={inputCls} required defaultValue={state.question} />
        <SubmitButton pending="Denke nach …">Fragen</SubmitButton>
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.answer && (
        <div className="space-y-3">
          <div className="whitespace-pre-wrap rounded-md bg-black/5 p-3 text-sm dark:bg-white/5">{state.answer}</div>
          {state.hits && state.hits.length > 0 && (
            <ol className="space-y-2 text-xs">
              {state.hits.map((h, i) => (
                <li key={h.id} className="rounded-md border border-black/10 p-2 dark:border-white/10">
                  <div className="mb-1 font-medium">
                    [{i + 1}] {h.title} <span className="font-normal text-ink-400 dark:text-ink-200">· Score {h.score.toFixed(3)}</span>
                  </div>
                  <div className="line-clamp-4 whitespace-pre-wrap text-ink-600 dark:text-ink-400">{h.content}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

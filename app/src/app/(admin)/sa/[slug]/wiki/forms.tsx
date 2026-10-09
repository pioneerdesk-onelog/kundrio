"use client";

import { useActionState } from "react";
import { inputCls } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/c/SubmitButton";
import { createPage, indexWikiPage, proposeLlm, savePage, type FormState } from "./actions";

export function NewPageForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(createPage.bind(null, slug), {} as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="title" placeholder="Titel der neuen Seite" className={`${inputCls} max-w-sm`} required maxLength={200} />
      <SubmitButton pending="Lege an …">Seite anlegen</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function EditForm({ slug, pageSlug, title, body }: { slug: string; pageSlug: string; title: string; body: string }) {
  const [state, action] = useActionState(savePage.bind(null, slug, pageSlug), {} as FormState);
  return (
    <form action={action} className="space-y-2">
      <input name="title" defaultValue={title} className={inputCls} required maxLength={200} />
      <textarea name="body" defaultValue={body} rows={22} className={`${inputCls} font-mono text-xs`} />
      <input name="note" placeholder="Änderungsnotiz (optional)" className={inputCls} maxLength={300} />
      <div className="flex items-center gap-3">
        <SubmitButton pending="Speichere …">Speichern</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ProposeForm({ slug, pageSlug }: { slug: string; pageSlug: string }) {
  const [state, action] = useActionState(proposeLlm.bind(null, slug, pageSlug), {} as FormState);
  return (
    <form action={action} className="space-y-2">
      <input name="focus" placeholder="Schwerpunkt (optional), z. B. „Preise ergänzen“" className={inputCls} maxLength={500} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending="Modell schreibt … (kann dauern)">LLM-Vorschlag erzeugen</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function IndexWikiButton({ slug, pageSlug }: { slug: string; pageSlug: string }) {
  const [state, action] = useActionState(indexWikiPage.bind(null, slug, pageSlug), {} as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton ghost pending="Indiziere …">Ins Wissen übernehmen</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

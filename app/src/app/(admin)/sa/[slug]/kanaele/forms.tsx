"use client";

import { useActionState } from "react";
import { inputCls } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/c/SubmitButton";
import { PLATFORM_LABELS, PLATFORMS } from "@/lib/channels/types";
import { addChannel, addMetric, selectAccount, syncChannel, type FormState } from "./actions";

export function AddChannelForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(addChannel.bind(null, slug), {} as FormState);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <label className="sr-only" htmlFor="ch-platform">Plattform</label>
      <select id="ch-platform" name="platform" className={inputCls} required defaultValue="linkedin">
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
        ))}
      </select>
      <input name="handle" aria-label="Handle oder Name" placeholder="Handle/Name, z. B. @onelog oder Seitenname" className={inputCls} required maxLength={200} />
      <input name="url" type="url" aria-label="URL" placeholder="URL (optional)" className={inputCls} />
      <input name="externalId" aria-label="Plattform-ID" placeholder="Plattform-ID (optional, z. B. YouTube UC…)" className={inputCls} maxLength={200} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton pending="Speichere …">Kanal hinzufügen</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function MetricForm({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState(addMetric.bind(null, slug, id), {} as FormState);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="date" type="date" aria-label="Datum" defaultValue={today} className={`${inputCls} w-36`} required />
      <input name="followers" type="number" min={0} aria-label="Follower" placeholder="Follower" className={`${inputCls} w-28`} />
      <input name="views" type="number" min={0} aria-label="Aufrufe" placeholder="Aufrufe" className={`${inputCls} w-28`} />
      <input name="posts" type="number" min={0} aria-label="Beiträge" placeholder="Beiträge" className={`${inputCls} w-28`} />
      <SubmitButton ghost pending="…">Eintragen</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function SyncButton({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState(syncChannel.bind(null, slug, id), {} as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <SubmitButton pending="Rufe ab …">Jetzt abrufen</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function SelectAccountForm({ slug, id, candidates, current }: { slug: string; id: string; candidates: { id: string; name: string }[]; current: string | null }) {
  const [state, action] = useActionState(selectAccount.bind(null, slug, id), {} as FormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label className="text-sm" htmlFor={`sel-${id}`}>Zu lesendes Konto</label>
      <select id={`sel-${id}`} name="externalId" defaultValue={current ?? ""} className={`${inputCls} w-auto`} required>
        <option value="" disabled>– wählen –</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <SubmitButton ghost pending="…">Übernehmen</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

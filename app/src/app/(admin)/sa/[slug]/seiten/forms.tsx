"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "./actions";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function Msg({ s }: { s: ActionState }) {
  if (s.error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{s.error}</p>;
  if (s.ok) return <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{s.ok}</p>;
  return null;
}

function LangSelect({ langs, names, name = "lang", defaultValue }: { langs: string[]; names: Record<string, string>; name?: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? langs[0]} className={inputCls}>
      {langs.map((l) => <option key={l} value={l}>{names[l] ?? l} ({l})</option>)}
    </select>
  );
}

export function CreatePageForm({ action, langs, names }: { action: Act; langs: string[]; names: Record<string, string> }) {
  const [s, a, pending] = useActionState(action, {});
  return (
    <form action={a} className="space-y-3">
      <label className="block"><span className={labelCls}>Titel</span><input name="title" required maxLength={160} className={inputCls} placeholder="z. B. Webinar IT-Sicherheit für KMU" /></label>
      <label className="block"><span className={labelCls}>Adresse (optional, wird sonst aus dem Titel gebildet)</span><input name="slug" maxLength={80} pattern="[a-z0-9-]+" className={inputCls} placeholder="webinar-it-sicherheit" /></label>
      <label className="block"><span className={labelCls}>Sprache</span><LangSelect langs={langs} names={names} /></label>
      <Msg s={s} />
      <button className={btnCls} disabled={pending}>{pending ? "Anlegen …" : "Seite anlegen und bearbeiten"}</button>
    </form>
  );
}

export function AiDraftForm({ action, langs, names }: { action: Act; langs: string[]; names: Record<string, string> }) {
  const [s, a, pending] = useActionState(action, {});
  return (
    <form action={a} className="space-y-3">
      <label className="block"><span className={labelCls}>Titel</span><input name="title" required maxLength={160} className={inputCls} /></label>
      <label className="block">
        <span className={labelCls}>Briefing: Ziel, Zielgruppe, Angebot, gewünschte Aktion</span>
        <textarea name="brief" required minLength={20} maxLength={4000} rows={5} className={inputCls} placeholder="Landingpage für ein kostenloses Webinar … Zielgruppe: Geschäftsführer von KMU in Bayern … Aktion: Anmeldung über das Formular" />
      </label>
      <label className="block"><span className={labelCls}>Sprache</span><LangSelect langs={langs} names={names} /></label>
      <p className="text-sm text-ink-400 dark:text-ink-200">Das lokale Modell nutzt nur Fakten aus Wiki und Wissensbasis dieses Sub-Accounts. Das Ergebnis ist ein Entwurf – bitte prüfen.</p>
      <Msg s={s} />
      <button className={btnGhostCls} disabled={pending}>{pending ? "Wird gestartet …" : "Entwurf mit KI erstellen"}</button>
    </form>
  );
}

export function SeoForm({ action, page }: { action: Act; page: { title: string; slug: string; seoTitle: string | null; seoDescription: string | null } }) {
  const [s, a, pending] = useActionState(action, {});
  return (
    <form action={a} className="space-y-3">
      <label className="block"><span className={labelCls}>Seitentitel</span><input name="title" defaultValue={page.title} required maxLength={160} className={inputCls} /></label>
      <label className="block"><span className={labelCls}>Adresse</span><input name="slug" defaultValue={page.slug} required maxLength={80} pattern="[a-z0-9-]+" className={inputCls} /></label>
      <label className="block"><span className={labelCls}>SEO-Titel (max. 70 Zeichen)</span><input name="seoTitle" defaultValue={page.seoTitle ?? ""} maxLength={70} className={inputCls} /></label>
      <label className="block"><span className={labelCls}>Beschreibung für Suchmaschinen und KI-Antworten (max. 170 Zeichen)</span><textarea name="seoDescription" defaultValue={page.seoDescription ?? ""} maxLength={170} rows={3} className={inputCls} /></label>
      <Msg s={s} />
      <button className={btnGhostCls} disabled={pending}>Speichern</button>
    </form>
  );
}

export function PublishButton({ action, label }: { action: (prev: ActionState) => Promise<ActionState>; label: string }) {
  const [s, a, pending] = useActionState(action, {});
  return (
    <form action={a} className="space-y-2">
      <button className={btnCls} disabled={pending}>{pending ? "Prüfe Barrierefreiheit …" : label}</button>
      <Msg s={s} />
    </form>
  );
}

export function TranslateForm({ action, langs, names }: { action: Act; langs: string[]; names: Record<string, string> }) {
  const [s, a, pending] = useActionState(action, {});
  if (langs.length === 0) return <p className="text-sm text-ink-400 dark:text-ink-200">Keine weiteren Sprachen freigeschaltet (Einstellungen → Sprachen).</p>;
  return (
    <form action={a} className="flex flex-wrap items-end gap-2">
      <label className="block min-w-48"><span className={labelCls}>Zielsprache</span><LangSelect langs={langs} names={names} /></label>
      <button className={btnGhostCls} disabled={pending}>{pending ? "…" : "Sprachfassung mit KI erzeugen"}</button>
      <div className="w-full"><Msg s={s} /></div>
    </form>
  );
}

/** Aktualisiert die Seite, solange KI-Jobs laufen. */
export function RefreshWhilePending({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [pending, router]);
  return null;
}

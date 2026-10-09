"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Sparkles } from "lucide-react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { InboxActionState } from "@/app/(admin)/sa/[slug]/posteingang/actions";

type ReplyFn = (prev: InboxActionState, fd: FormData) => Promise<InboxActionState>;

function SendButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={btnCls} disabled={pending}>
      {pending ? "Wird gesendet …" : label}
    </button>
  );
}

/**
 * Antworten bzw. interne Notiz. „KI-Entwurf“ füllt nur das Textfeld – gesendet wird erst per Klick.
 * Tastenkürzel: r = ins Antwortfeld springen.
 */
export function ReplyBox({
  reply,
  note,
  draft,
  channelLabel,
  subject,
  attachments,
  hint,
}: {
  reply: ReplyFn;
  note: ReplyFn;
  draft: () => Promise<InboxActionState>;
  channelLabel: string;
  subject: boolean;
  attachments: boolean;
  hint?: string;
}) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [replyState, replyAction] = useActionState(reply, {});
  const [noteState, noteAction] = useActionState(note, {});
  const [draftInfo, setDraftInfo] = useState<InboxActionState>({});
  const [pending, start] = useTransition();
  const text = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setMode("reply");
        text.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (replyState.ok) formRef.current?.reset();
  }, [replyState]);

  const state = mode === "reply" ? replyState : noteState;

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
      <div role="tablist" aria-label="Antwortart" className="mb-3 flex gap-2">
        <button type="button" role="tab" aria-selected={mode === "reply"} className={mode === "reply" ? btnCls : btnGhostCls} onClick={() => setMode("reply")}>
          Antworten ({channelLabel})
        </button>
        <button type="button" role="tab" aria-selected={mode === "note"} className={mode === "note" ? btnCls : btnGhostCls} onClick={() => setMode("note")}>
          Interne Notiz
        </button>
      </div>

      {mode === "reply" ? (
        <form ref={formRef} action={replyAction} className="space-y-3" encType="multipart/form-data">
          {subject && (
            <label className="block">
              <span className={labelCls}>Kopie an (optional)</span>
              <input name="cc" className={inputCls} placeholder="name@firma.de, …" />
            </label>
          )}
          <label className="block">
            <span className="sr-only">Antworttext</span>
            <textarea ref={text} name="text" rows={7} required className={inputCls} placeholder="Ihre Antwort … (r = hierher springen)" />
          </label>
          {hint && <p className="text-sm text-amber-700 dark:text-amber-300">{hint}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <SendButton label="Senden" />
            <button
              type="button"
              className={btnGhostCls}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await draft();
                  setDraftInfo(r);
                  if (r.draft && text.current) {
                    text.current.value = r.draft;
                    text.current.focus();
                  }
                })
              }
            >
              <Sparkles size={16} aria-hidden /> {pending ? "Entwurf wird erstellt …" : "KI-Entwurf"}
            </button>
            {attachments && <input type="file" name="attachments" multiple className="text-sm" aria-label="Anhänge (max. 900 KB je Datei)" />}
          </div>
          {draftInfo.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{draftInfo.error}</p>}
          {draftInfo.ok && <p className="text-sm text-ink-400 dark:text-ink-200">KI-Entwurf – bitte prüfen. {draftInfo.ok}</p>}
        </form>
      ) : (
        <form action={noteAction} className="space-y-3">
          <label className="block">
            <span className="sr-only">Notiz</span>
            <textarea name="note" rows={4} required className={inputCls} placeholder="Nur intern sichtbar – der Kunde sieht das nicht." />
          </label>
          <SendButton label="Notiz speichern" />
        </form>
      )}
      {state.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
    </div>
  );
}

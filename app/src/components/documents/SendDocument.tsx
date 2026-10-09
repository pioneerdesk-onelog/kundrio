"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { btnCls, inputCls, labelCls } from "@/components/ui";

type State = { error?: string; ok?: string };

// Versand eines Belegs per E-Mail mit PDF-Anhang: Vorschau (vorbelegt aus „Texte & Vorlagen“) → senden.
export function SendDocument({
  action,
  draft,
  isQuote,
  needsApproval,
  pdfHref,
}: {
  action: (s: State, f: FormData) => Promise<State>;
  draft: { to: string; subject: string; body: string };
  isQuote: boolean;
  needsApproval: boolean;
  pdfHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="send-to" className={labelCls}>An</label>
          <input id="send-to" name="to" type="email" required maxLength={254} defaultValue={draft.to} className={inputCls} />
        </div>
        <div>
          <label htmlFor="send-subject" className={labelCls}>Betreff</label>
          <input id="send-subject" name="subject" required maxLength={300} defaultValue={draft.subject} className={inputCls} />
        </div>
      </div>
      <div>
        <label htmlFor="send-body" className={labelCls}>Text</label>
        <textarea id="send-body" name="body" required rows={8} maxLength={8000} defaultValue={draft.body} className={inputCls} />
      </div>
      {isQuote && (
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" name="withAcceptLink" defaultChecked />
          Link zur Online-Annahme mitsenden (Kunde kann das Angebot mit einem Klick annehmen)
        </label>
      )}
      <p className="text-sm text-ink-400 dark:text-ink-200">
        Das PDF (<a className="underline" href={pdfHref} target="_blank" rel="noreferrer">ansehen</a>) wird angehängt.
        {needsApproval && " Der Versand wird als Freigabe angefragt und erst nach Zustimmung ausgeführt."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button className={btnCls} disabled={pending}>
          <Send size={16} aria-hidden /> {pending ? "Wird gesendet …" : needsApproval ? "Versand zur Freigabe vorlegen" : "Per E-Mail senden"}
        </button>
        {state.error && <p role="alert" className="text-red-700 dark:text-red-300">{state.error}</p>}
        {state.ok && <p role="status" className="text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
      </div>
    </form>
  );
}

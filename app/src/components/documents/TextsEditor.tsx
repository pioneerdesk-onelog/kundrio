"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { PLACEHOLDERS, TEXT_FIELDS, TEXT_FIELD_LABEL, renderDocText, unknownPlaceholders, type DocContext, type DocTexts, type TextField } from "@/lib/documents/texts";

type State = { error?: string; ok?: string };

// Editor für die Standardtexte einer Belegart: Platzhalter einfügen, Live-Vorschau mit echtem Beispielbeleg,
// optional KI-Vorschlag (nur ins Feld, gespeichert wird erst mit „Speichern“).
export function TextsEditor({
  kindLabel,
  initial,
  defaults,
  sample,
  sampleLabel,
  action,
  suggest,
  canEdit,
  showPaymentTerms,
}: {
  kindLabel: string;
  initial: DocTexts;
  defaults: DocTexts;
  sample: DocContext;
  sampleLabel: string;
  action: (s: State, f: FormData) => Promise<State>;
  suggest: (input: { field: TextField; current: string; wish: string }) => Promise<{ text?: string; error?: string }>;
  canEdit: boolean;
  showPaymentTerms: boolean;
}) {
  const [values, setValues] = useState<DocTexts>(initial);
  const [focus, setFocus] = useState<TextField>("intro");
  const [state, formAction, pending] = useActionState(action, {});
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [wish, setWish] = useState("");
  const [aiPending, startAi] = useTransition();
  const refs = useRef<Partial<Record<TextField, HTMLTextAreaElement | HTMLInputElement | null>>>({});

  const fields = TEXT_FIELDS.filter((f) => f !== "paymentTerms" || showPaymentTerms);
  const insert = (key: string) => {
    const el = refs.current[focus];
    const token = `{{ ${key} }}`;
    const cur = values[focus];
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    setValues((v) => ({ ...v, [focus]: next }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const unknown = [...new Set(fields.flatMap((f) => unknownPlaceholders(values[f])))];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={formAction} className="space-y-4">
        <fieldset disabled={!canEdit || pending} className="space-y-4">
          {fields.map((f) => (
            <div key={f}>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`t-${f}`} className={labelCls}>{TEXT_FIELD_LABEL[f]}</label>
                {values[f] !== defaults[f] && (
                  <button type="button" className="text-sm text-accent-500 underline dark:text-accent-100" onClick={() => setValues((v) => ({ ...v, [f]: defaults[f] }))}>
                    Standardtext
                  </button>
                )}
              </div>
              {f === "emailSubject" ? (
                <input
                  id={`t-${f}`}
                  name={f}
                  ref={(el) => { refs.current[f] = el; }}
                  value={values[f]}
                  maxLength={300}
                  onFocus={() => setFocus(f)}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  className={inputCls}
                />
              ) : (
                <textarea
                  id={`t-${f}`}
                  name={f}
                  ref={(el) => { refs.current[f] = el; }}
                  rows={f === "emailBody" ? 9 : f === "paymentTerms" ? 2 : 5}
                  maxLength={f === "emailBody" ? 8000 : 4000}
                  value={values[f]}
                  onFocus={() => setFocus(f)}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  className={inputCls}
                />
              )}
            </div>
          ))}
          {!showPaymentTerms && <input type="hidden" name="paymentTerms" value={values.paymentTerms} />}
        </fieldset>

        {unknown.length > 0 && (
          <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">Unbekannte Platzhalter: {unknown.join(", ")} – bitte aus der Liste wählen.</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button className={btnCls} disabled={pending || unknown.length > 0}>{pending ? "Speichern …" : `Texte für „${kindLabel}“ speichern`}</button>
            {state.error && <p role="alert" className="text-red-700 dark:text-red-300">{state.error}</p>}
            {state.ok && <p role="status" className="text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
          </div>
        )}
      </form>

      <div className="space-y-4">
        <section aria-labelledby="ph-h" className="rounded-lg border border-ink-100 p-4 dark:border-white/10">
          <h3 id="ph-h" className="mb-1 font-semibold">Platzhalter einfügen</h3>
          <p className="mb-3 text-sm text-ink-400 dark:text-ink-200">Wird an der Cursor-Position in „{TEXT_FIELD_LABEL[focus]}“ eingefügt.</p>
          {PLACEHOLDERS.map((g) => (
            <div key={g.group} className="mb-2">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-400">{g.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((p) => (
                  <button key={p.key} type="button" disabled={!canEdit} title={p.label} onClick={() => insert(p.key)} className="rounded-full bg-sand-100 px-2.5 py-1 text-sm text-ink-800 hover:bg-sand-200 disabled:opacity-50 dark:bg-white/10 dark:text-ink-100">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {canEdit && (
          <section aria-labelledby="ai-h" className="rounded-lg border border-ink-100 p-4 dark:border-white/10">
            <h3 id="ai-h" className="mb-2 flex items-center gap-2 font-semibold"><Sparkles size={16} aria-hidden /> Formulierungshilfe (KI, lokal/EU)</h3>
            <label htmlFor="ai-wish" className="sr-only">Wunsch an die Formulierung</label>
            <input id="ai-wish" value={wish} onChange={(e) => setWish(e.target.value)} maxLength={500} placeholder={`z. B. „kürzer und persönlicher“ – für ${TEXT_FIELD_LABEL[focus]}`} className={inputCls} />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                className={btnGhostCls}
                disabled={aiPending}
                onClick={() =>
                  startAi(async () => {
                    setAiMsg(null);
                    const r = await suggest({ field: focus, current: values[focus], wish });
                    if (r.text) {
                      setValues((v) => ({ ...v, [focus]: r.text! }));
                      setAiMsg("Vorschlag eingesetzt – bitte prüfen und dann speichern.");
                    } else setAiMsg(r.error ?? "Kein Vorschlag.");
                  })
                }
              >
                {aiPending ? "Formuliere …" : "Text vorschlagen"}
              </button>
              {aiMsg && <p role="status" className="text-sm text-ink-600 dark:text-ink-200">{aiMsg}</p>}
            </div>
          </section>
        )}

        <section aria-labelledby="pv-h" className="rounded-lg border border-ink-100 bg-white p-4 dark:border-white/10 dark:bg-ink-900">
          <h3 id="pv-h" className="mb-1 font-semibold">Vorschau</h3>
          <p className="mb-3 text-sm text-ink-400 dark:text-ink-200">Mit Daten aus {sampleLabel}.</p>
          <div className="space-y-3 text-[15px]">
            <p><span className="text-ink-400">Betreff: </span>{renderDocText(values.emailSubject, sample)}</p>
            <pre className="whitespace-pre-wrap font-sans">{renderDocText(values.emailBody, sample)}</pre>
            <hr className="border-ink-100 dark:border-white/10" />
            <pre className="whitespace-pre-wrap font-sans">{renderDocText(values.intro, sample)}</pre>
            <p className="text-sm italic text-ink-400">[Positionen und Summen]</p>
            {showPaymentTerms && <pre className="whitespace-pre-wrap font-sans">{renderDocText(values.paymentTerms, sample)}</pre>}
            <pre className="whitespace-pre-wrap font-sans">{renderDocText(values.outro, sample)}</pre>
          </div>
        </section>
      </div>
    </div>
  );
}

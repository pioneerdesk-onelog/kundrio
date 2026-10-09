import { btnCls, inputCls } from "@/components/ui";

type Values = { name: string; subject: string; bodyMarkdown: string; tags: string; listIds?: string[] };
type ListOption = { id: string; name: string; numericId: number; count: number };

export function CampaignForm({
  action,
  values,
  locked,
  lists = [],
}: {
  action: (fd: FormData) => Promise<void>;
  values?: Values;
  locked?: boolean;
  lists?: ListOption[];
}) {
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        Name (intern)
        <input name="name" required maxLength={120} defaultValue={values?.name} disabled={locked} className={inputCls} />
      </label>
      <label className="block text-sm">
        Betreff
        <input name="subject" required maxLength={200} defaultValue={values?.subject} disabled={locked} className={inputCls} />
      </label>
      <label className="block text-sm">
        Text
        <textarea name="bodyMarkdown" required rows={12} maxLength={50000} defaultValue={values?.bodyMarkdown} disabled={locked} className={`${inputCls} font-mono`} />
        <span className="mt-1 block text-sm text-ink-400 dark:text-ink-200">
          Platzhalter: <code>{"{{ contact.FIRSTNAME }}"}</code>, <code>{"{{ contact.LASTNAME }}"}</code>, <code>{"{{ contact.COMPANY }}"}</code>, eigene Felder wie <code>{"{{ contact.BRANCHE }}"}</code>.
          Ohne Wert: <code>{'{{ contact.FIRSTNAME | default: "zusammen" }}'}</code>. Der Abmeldelink wird automatisch angehängt.
        </span>
      </label>
      <label className="block text-sm">
        Zielgruppe: Tags (kommagetrennt, leer = alle mit Einwilligung)
        <input name="tags" maxLength={500} defaultValue={values?.tags} disabled={locked} className={inputCls} placeholder="newsletter, kunde" />
      </label>
      {lists.length > 0 && (
        <fieldset className="text-sm">
          <legend>Zielgruppe: Listen (zusätzlich zu Tags; Kontakt muss in einer Liste ODER einem Tag sein)</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {lists.map((l) => (
              <label key={l.id} className="inline-flex items-center gap-1.5">
                <input type="checkbox" name="listIds" value={l.id} defaultChecked={values?.listIds?.includes(l.id)} disabled={locked} />
                {l.name} <span className="text-xs text-ink-400">#{l.numericId} · {l.count}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-xs text-ink-400 dark:text-ink-200">
        Anrede („Hallo Vorname,“) und Abmeldelink werden automatisch ergänzt. Es werden nur Kontakte mit bestätigter
        Einwilligung angeschrieben, die sich nicht abgemeldet haben.
      </p>
      {!locked && <button className={btnCls}>Speichern</button>}
    </form>
  );
}

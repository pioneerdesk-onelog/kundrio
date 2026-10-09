"use client";

import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { btnCls, btnGhostCls, inputCls } from "@/components/ui";

type Field = { key: string; label: string; type: "text" | "email" | "tel" | "textarea"; required: boolean };

const DEFAULT: Field[] = [
  { key: "firstName", label: "Vorname", type: "text", required: false },
  { key: "lastName", label: "Nachname", type: "text", required: false },
  { key: "email", label: "E-Mail", type: "email", required: true },
];

export function FormBuilder({
  action,
  initial,
}: {
  action: (fd: FormData) => Promise<void>;
  initial?: { name: string; fields: Field[]; consentText: string };
}) {
  const [fields, setFields] = useState<Field[]>(initial?.fields.length ? initial.fields : DEFAULT);

  const update = (i: number, patch: Partial<Field>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm">
        Name des Formulars
        <input name="name" required maxLength={120} defaultValue={initial?.name} className={inputCls} />
      </label>

      <div className="space-y-2">
        <div className="text-sm font-medium">Felder</div>
        <p className="text-xs text-ink-400 dark:text-ink-200">
          Schlüssel firstName, lastName, email, phone, company werden in den Kontakt übernommen.
        </p>
        {fields.map((f, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <input aria-label="Schlüssel" className={`${inputCls} col-span-3`} value={f.key} onChange={(e) => update(i, { key: e.target.value })} placeholder="schluessel" />
            <input aria-label="Beschriftung" className={`${inputCls} col-span-4`} value={f.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Beschriftung" />
            <select aria-label="Typ" className={`${inputCls} col-span-2`} value={f.type} onChange={(e) => update(i, { type: e.target.value as Field["type"] })}>
              <option value="text">Text</option>
              <option value="email">E-Mail</option>
              <option value="tel">Telefon</option>
              <option value="textarea">Mehrzeilig</option>
            </select>
            <label className="col-span-1 flex items-center gap-1 text-xs">
              <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} /> Pflicht
            </label>
            <div className="col-span-2 flex gap-1">
              <button type="button" aria-label="nach oben" className={btnGhostCls} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
              <button type="button" aria-label="nach unten" className={btnGhostCls} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              <button type="button" aria-label="entfernen" className={btnGhostCls} onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={btnGhostCls}
          onClick={() => setFields((fs) => [...fs, { key: `feld${fs.length + 1}`, label: "Neues Feld", type: "text", required: false }])}
        >
          <Plus size={14} /> Feld
        </button>
      </div>

      <label className="block text-sm">
        Einwilligungstext für E-Mails (optional, aktiviert Double-Opt-in)
        <textarea name="consentText" rows={3} maxLength={1000} defaultValue={initial?.consentText} className={inputCls}
          placeholder="Ja, ich möchte den Newsletter per E-Mail erhalten. Abmeldung jederzeit möglich." />
      </label>

      <input type="hidden" name="fields" value={JSON.stringify(fields)} />
      <button className={btnCls}>Speichern</button>
    </form>
  );
}

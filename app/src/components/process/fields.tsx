"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { CONDITION_OPS, type Condition, type ConditionGroup, type ConditionOp } from "@/lib/process/definition";
import { opsFor, TYPE_SYMBOL, type CatalogField } from "@/lib/process/fields";
import { OPTION_LABELS } from "@/lib/process-ui/form";
import { btnGhostCls, inputCls, labelCls } from "@/components/ui";

const smallInput = `${inputCls} !py-1.5`;

const TYPE_LABEL: Record<CatalogField["type"], string> = {
  text: "Text",
  number: "Zahl",
  date: "Datum",
  boolean: "Ja/Nein",
  select: "Auswahl",
  multiselect: "Mehrfachauswahl",
  reference: "Verweis",
};

/**
 * Feldauswahl – ausschließlich Felder aus dem Katalog des Sub-Accounts (keine freien Pfade).
 * Ein gespeicherter Pfad, den es nicht (mehr) gibt, wird sichtbar als „nicht vorhanden“ markiert.
 */
export function FieldPicker({ value, onChange, fields, label, id, emptyLabel = "– Feld wählen –" }: { value: string; onChange: (v: string) => void; fields: CatalogField[]; label?: string; id?: string; emptyLabel?: string }) {
  const known = fields.some((f) => f.path === value);
  const groups = [...new Set(fields.map((f) => f.group))];
  const gen = useId();
  const fid = id ?? gen;
  return (
    <div>
      {label && (
        <label htmlFor={fid} className={labelCls}>
          {label}
        </label>
      )}
      <select id={fid} value={value} onChange={(e) => onChange(e.target.value)} className={`${smallInput} ${value && !known ? "!border-red-400" : ""}`} aria-invalid={Boolean(value && !known)}>
        <option value="">{emptyLabel}</option>
        {value && !known && <option value={value}>⚠ nicht vorhanden: {value}</option>}
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <option key={f.path} value={f.path}>
                  {TYPE_SYMBOL[f.type]} {f.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {value && !known && <p className="mt-1 text-sm text-red-700 dark:text-red-300">Dieses Feld gibt es an dieser Stelle nicht (gelöscht oder aus keinem vorherigen Schritt). Bitte ein vorhandenes Feld wählen.</p>}
      {value && known && <p className="mt-1 text-xs text-ink-400 dark:text-ink-200">Typ: {TYPE_LABEL[fields.find((f) => f.path === value)!.type]}</p>}
    </div>
  );
}

type Scalar = string | number | boolean | null | undefined;

/** Datumswert für „Eigenschaft setzen“: relativ (in N Tagen) oder fest. */
function DateValue({ value, onChange, id }: { value: Scalar; onChange: (v: Scalar) => void; id?: string }) {
  const rel = typeof value === "string" ? value.match(/^now([+-])(\d{1,5})d$/i) : null;
  const days = rel ? (rel[1] === "-" ? -1 : 1) * Number(rel[2]) : null;
  const mode = value === null ? "null" : rel || value === undefined || value === "" ? "rel" : "abs";
  return (
    <div className="flex gap-2">
      <select aria-label="Art des Datums" value={mode} onChange={(e) => onChange(e.target.value === "null" ? null : e.target.value === "rel" ? "now+1d" : new Date().toISOString().slice(0, 10))} className={`${smallInput} !w-36 shrink-0`}>
        <option value="rel">in … Tagen</option>
        <option value="abs">festes Datum</option>
        <option value="null">leeren</option>
      </select>
      {mode === "rel" && (
        <input id={id} type="number" min={-3650} max={3650} value={days ?? 1} onChange={(e) => onChange(`now${Number(e.target.value) < 0 ? "-" : "+"}${Math.abs(Number(e.target.value) || 0)}d`)} className={smallInput} aria-label="Tage ab heute" />
      )}
      {mode === "abs" && <input id={id} type="date" value={String(value ?? "").slice(0, 10)} onChange={(e) => onChange(e.target.value)} className={smallInput} />}
    </div>
  );
}

/** Wert passend zum Feldtyp (Auswahl, Zahl, Datum, Ja/Nein, Text). Ohne Feld: Hinweis statt freier Eingabe. */
export function ValueInput({ value, onChange, field, id, allowClear = true }: { value: Scalar; onChange: (v: Scalar) => void; field?: CatalogField; id?: string; allowClear?: boolean }) {
  if (!field) return <p className="text-sm text-ink-400 dark:text-ink-200">Bitte zuerst ein Feld wählen.</p>;
  const clear = allowClear ? <option value="__null">– leeren –</option> : null;
  if ((field.type === "select" || field.type === "reference" || field.type === "multiselect") && field.options) {
    const v = value === null ? "__null" : value == null ? "" : String(value);
    const unknown = v !== "" && v !== "__null" && !field.options.some((o) => o.value === v);
    return (
      <div>
        <select id={id} value={v} onChange={(e) => onChange(e.target.value === "__null" ? null : e.target.value)} className={`${smallInput} ${unknown ? "!border-red-400" : ""}`}>
          <option value="">– wählen –</option>
          {clear}
          {unknown && <option value={v}>⚠ nicht vorhanden: {v}</option>}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.options.length === 0 && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Für dieses Feld gibt es noch keine Werte im Sub-Account.</p>}
      </div>
    );
  }
  if (field.type === "number") {
    return <input id={id} type="number" value={value == null ? "" : Number(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={smallInput} />;
  }
  if (field.type === "boolean") {
    return (
      <select id={id} value={value === true ? "1" : value === false ? "0" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "1")} className={smallInput}>
        <option value="">– wählen –</option>
        <option value="1">Ja</option>
        <option value="0">Nein</option>
      </select>
    );
  }
  if (field.type === "date") return <DateValue value={value} onChange={onChange} id={id} />;
  return <input id={id} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} className={smallInput} maxLength={1000} />;
}

const NO_VALUE: ConditionOp[] = ["is_set", "is_not_set"];
const NUMERIC: ConditionOp[] = ["gt", "lt", "days_ago_gt", "days_ago_lt"];

/** Eine Bedingung: Feld · Vergleich · Wert – Vergleiche und Werte passen sich dem Feldtyp an. */
export function ConditionRow({ value, onChange, onRemove, fields }: { value: Condition; onChange: (c: Condition) => void; onRemove?: () => void; fields: CatalogField[] }) {
  const field = fields.find((f) => f.path === value.field);
  const ops = field ? opsFor(field) : [];
  const op = value.op;
  const opInvalid = field && !ops.includes(op);
  const setField = (path: string) => {
    const f = fields.find((x) => x.path === path);
    const allowed = f ? opsFor(f) : [];
    const nop = allowed.includes(op) ? op : (allowed[0] ?? "is_set");
    onChange({ field: path, op: nop, value: NO_VALUE.includes(nop) ? undefined : NUMERIC.includes(nop) ? 0 : nop === "in" ? [] : "" });
  };
  return (
    <div className="space-y-2 rounded-lg border border-ink-100 p-2.5 dark:border-white/10">
      <FieldPicker value={value.field} onChange={setField} fields={fields} />
      <div className="flex gap-2">
        <select
          aria-label="Vergleich"
          value={op}
          disabled={!field}
          onChange={(e) => {
            const nop = e.target.value as ConditionOp;
            const v = NO_VALUE.includes(nop) ? undefined : NUMERIC.includes(nop) ? Number(value.value) || 0 : nop === "in" ? (Array.isArray(value.value) ? value.value : []) : Array.isArray(value.value) ? "" : value.value;
            onChange({ ...value, op: nop, value: v });
          }}
          className={`${smallInput} ${opInvalid ? "!border-red-400" : ""}`}
        >
          {opInvalid && <option value={op}>⚠ {CONDITION_OPS[op]} (passt nicht zum Feld)</option>}
          {ops.map((k) => (
            <option key={k} value={k}>
              {CONDITION_OPS[k]}
            </option>
          ))}
        </select>
        {onRemove && (
          <button type="button" onClick={onRemove} className="rounded-md px-2 text-ink-400 hover:bg-red-50 hover:text-red-700" aria-label="Bedingung entfernen">
            <Trash2 size={16} aria-hidden />
          </button>
        )}
      </div>
      {field && !NO_VALUE.includes(op) &&
        (op === "in" ? (
          <MultiPick field={field} value={Array.isArray(value.value) ? value.value : []} onChange={(v) => onChange({ ...value, value: v })} />
        ) : NUMERIC.includes(op) ? (
          <input
            type="number"
            aria-label={op.startsWith("days") ? "Tage" : "Zahl"}
            value={Number(value.value ?? 0)}
            onChange={(e) => onChange({ ...value, value: Number(e.target.value) })}
            className={smallInput}
          />
        ) : (
          <ValueInput
            field={field.type === "multiselect" ? { ...field, type: "select" } : field}
            allowClear={false}
            value={(Array.isArray(value.value) ? "" : value.value) as Scalar}
            onChange={(v) => onChange({ ...value, value: v === null || v === undefined ? "" : (v as string | number | boolean) })}
          />
        ))}
    </div>
  );
}

/** „ist eins von“: Auswahl mehrerer vorhandener Werte (bei Textfeldern: einer je Zeile). */
function MultiPick({ field, value, onChange }: { field: CatalogField; value: string[]; onChange: (v: string[]) => void }) {
  if (!field.options) {
    return (
      <textarea
        aria-label="Werte (einer je Zeile)"
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 50))}
        rows={3}
        placeholder="Ein Wert je Zeile"
        className={smallInput}
      />
    );
  }
  const sel = new Set(value);
  return (
    <fieldset className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-ink-100 p-2 dark:border-white/10">
      <legend className="sr-only">Werte</legend>
      {field.options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            checked={sel.has(o.value)}
            onChange={(e) => {
              const next = new Set(sel);
              if (e.target.checked) next.add(o.value);
              else next.delete(o.value);
              onChange([...next]);
            }}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Gruppe von Bedingungen mit Verknüpfung (alle / mindestens eine). */
export function ConditionGroupEditor({ value, onChange, fields, emptyText = "Keine Bedingung – trifft immer zu." }: { value: ConditionGroup; onChange: (g: ConditionGroup) => void; fields: CatalogField[]; emptyText?: string }) {
  const g = value ?? { match: "all", conditions: [] };
  const first = fields.find((f) => f.path === "contact.lifecycleStage") ?? fields[0];
  return (
    <div className="space-y-2">
      {g.conditions.length > 1 && (
        <select aria-label="Verknüpfung" value={g.match} onChange={(e) => onChange({ ...g, match: e.target.value as "all" | "any" })} className={smallInput}>
          <option value="all">{OPTION_LABELS.all}</option>
          <option value="any">{OPTION_LABELS.any}</option>
        </select>
      )}
      {g.conditions.length === 0 && <p className="text-sm text-ink-400 dark:text-ink-200">{emptyText}</p>}
      {g.conditions.map((c, i) => (
        <ConditionRow
          key={i}
          value={c}
          fields={fields}
          onChange={(nc) => onChange({ ...g, conditions: g.conditions.map((x, j) => (j === i ? nc : x)) })}
          onRemove={() => onChange({ ...g, conditions: g.conditions.filter((_, j) => j !== i) })}
        />
      ))}
      {g.conditions.length < 20 && first && (
        <button
          type="button"
          className={btnGhostCls}
          onClick={() => onChange({ ...g, conditions: [...g.conditions, { field: first.path, op: opsFor(first)[0], value: NO_VALUE.includes(opsFor(first)[0]) ? undefined : "" }] })}
        >
          + Bedingung
        </button>
      )}
    </div>
  );
}

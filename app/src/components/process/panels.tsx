"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import {
  conditionSchema,
  NODE_TYPES,
  OBJECT_LABELS,
  TRIGGER_TYPES,
  type Condition,
  type ConditionGroup,
  type ObjectType,
  type ProcessDefinition,
  type ProcessNode,
  type TriggerType,
  type ValidationIssue,
} from "@/lib/process/definition";
import { defaultItem, fieldsFor, OPTION_LABELS, type FieldSpec } from "@/lib/process-ui/form";
import { NODE_HELP, TRIGGER_HELP } from "@/lib/process-ui/help";
import { availableFields, CHANNELS, RETURN_REASONS as RETURN_REASON_OPTS, PAID_VIA, EMAIL_EVENTS as CATALOG_EMAIL_EVENTS, objectFields, writableFields, type CatalogField } from "@/lib/process/fields";
import { btnDangerCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { ConditionGroupEditor, ConditionRow, FieldPicker, ValueInput } from "./fields";
import type { EditorOptions, Opt } from "./types";

const smallInput = `${inputCls} !py-1.5`;

function Help({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded-lg bg-sand-100 px-3 py-2 text-[15px] text-ink-600 dark:bg-white/5 dark:text-ink-100" open>
      <summary className="cursor-pointer text-sm font-medium text-ink-800 dark:text-ink-50">Was passiert hier?</summary>
      <p className="mt-1">{children}</p>
    </details>
  );
}

function Issues({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1" aria-live="polite">
      {issues.map((i, k) => (
        <li key={k} className={`rounded-md px-2.5 py-1.5 text-sm ${i.level === "error" ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200" : "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"}`}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

/** Auswahlliste für Felder mit Domänen-Bezug (Liste, Phase, Vorlage …). */
function domainOptions(key: string, nodeType: string, objectType: ObjectType, o: EditorOptions): { opts: Opt[]; numeric?: boolean; empty?: string } | null {
  if (key === "listId") return { opts: o.lists, empty: "Noch keine Listen angelegt." };
  if (key === "stageId") {
    const ot = nodeType === "action.create_deal" ? "deal" : nodeType === "action.create_ticket" ? "ticket" : objectType;
    return { opts: o.stages.filter((s) => s.objectType === ot), empty: "Keine passende Pipeline vorhanden." };
  }
  if (key === "stage" && nodeType === "action.set_lifecycle") return { opts: o.lifecycleStages, empty: "Keine Lifecycle-Phasen angelegt." };
  if (key === "templateId") return { opts: o.templates, numeric: true, empty: "Keine Vorlagen – Betreff und Text unten eingeben." };
  if (key === "webhookId") return { opts: o.webhooks, numeric: true, empty: "Keine Webhooks angelegt (API & Schnittstellen)." };
  if (key === "meetingTypeId") return { opts: o.catalog.meetingTypes ?? [], empty: "Keine Terminvorlagen – unter Kalender → Vorlagen anlegen." };
  return null;
}

type FieldCtx = {
  /** Felder, die an dieser Stelle des Ablaufs verfügbar sind (Objekte, Ereignis, frühere KI-Ergebnisse) */
  available: CatalogField[];
  /** Beschreibbare Felder (Eigenschaft setzen, KI-Ziele) */
  writable: CatalogField[];
  /** Konfiguration des ganzen Knotens (für abhängige Felder) */
  cfg: Record<string, unknown>;
};

/** Rendert ein einzelnes Feld anhand seiner Beschreibung. */
function Field({ spec, value, onChange, nodeType, objectType, options, ctx }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; nodeType: string; objectType: ObjectType; options: EditorOptions; ctx: FieldCtx }) {
  const id = useId();
  const label = `${spec.label}${spec.optional ? " (optional)" : ""}`;
  const dom = domainOptions(spec.key, nodeType, objectType, options);

  if (dom) {
    return (
      <div>
        <label htmlFor={id} className={labelCls}>
          {label}
        </label>
        <select
          id={id}
          value={value == null ? "" : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : dom.numeric ? Number(v) : v);
          }}
          className={smallInput}
        >
          <option value="">{spec.optional ? "– keine –" : "– wählen –"}</option>
          {dom.opts.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
        {dom.opts.length === 0 && dom.empty && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">{dom.empty}</p>}
      </div>
    );
  }

  if (spec.key === "userIds") {
    const sel = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <fieldset>
        <legend className={labelCls}>{label}</legend>
        {options.users.length === 0 && <p className="text-sm text-ink-400">Keine Personen mit Zugriff.</p>}
        <div className="space-y-1">
          {options.users.map((u) => (
            <label key={u.value} className="flex items-center gap-2 text-[15px]">
              <input
                type="checkbox"
                checked={sel.has(u.value)}
                onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(u.value);
                  else next.delete(u.value);
                  onChange([...next]);
                }}
              />
              {u.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  // Tags: vorhandene Tags zur Auswahl (Setzen darf einen neuen Tag anlegen, Entfernen nur vorhandene)
  if (spec.key === "tag" && (nodeType === "action.add_tag" || nodeType === "action.remove_tag")) {
    const listId = `${id}-tags`;
    if (nodeType === "action.remove_tag") {
      return (
        <div>
          <label htmlFor={id} className={labelCls}>
            {label}
          </label>
          <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={smallInput}>
            <option value="">– Tag wählen –</option>
            {options.catalog.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {options.catalog.tags.length === 0 && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Noch kein Kontakt hat einen Tag.</p>}
        </div>
      );
    }
    return (
      <div>
        <label htmlFor={id} className={labelCls}>
          {label}
        </label>
        <input id={id} list={listId} value={String(value ?? "")} maxLength={60} onChange={(e) => onChange(e.target.value.trim())} className={smallInput} />
        <datalist id={listId}>
          {options.catalog.tags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <p className="mt-1 text-xs text-ink-400 dark:text-ink-200">Vorhandenen Tag wählen oder neuen eingeben.</p>
      </div>
    );
  }

  // KI-Kategorien: bei Auswahlfeldern als Ziel nur deren vorhandene Werte
  if (spec.key === "categories" && nodeType === "ai.classify") {
    const target = ctx.writable.find((f) => f.path === ctx.cfg.target);
    const list = Array.isArray(value) ? (value as string[]) : [];
    if (target?.type === "select" && target.options) {
      const sel = new Set(list);
      return (
        <fieldset>
          <legend className={labelCls}>{label} – Werte von „{target.label}“</legend>
          <div className="space-y-1">
            {target.options.map((o) => (
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
          </div>
        </fieldset>
      );
    }
  }

  switch (spec.kind) {
    case "text":
      return (
        <div>
          <label htmlFor={id} className={labelCls}>
            {label}
          </label>
          <input id={id} value={String(value ?? "")} maxLength={spec.maxLength} onChange={(e) => onChange(spec.optional && e.target.value === "" ? undefined : e.target.value)} className={smallInput} />
        </div>
      );
    case "textarea":
      return (
        <div>
          <label htmlFor={id} className={labelCls}>
            {label}
          </label>
          <textarea id={id} value={String(value ?? "")} maxLength={spec.maxLength} rows={6} onChange={(e) => onChange(spec.optional && e.target.value === "" ? undefined : e.target.value)} className={smallInput} />
          {(nodeType === "action.send_email" || nodeType === "action.send_channel_message") && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Platzhalter: {"{{ contact.FIRSTNAME }}"}, {"{{ contact.COMPANY }}"}</p>}
        </div>
      );
    case "number":
      return (
        <div>
          <label htmlFor={id} className={labelCls}>
            {label}
          </label>
          <input
            id={id}
            type="number"
            min={spec.min}
            step={spec.integer ? 1 : "any"}
            value={value == null ? "" : Number(value)}
            onChange={(e) => onChange(e.target.value === "" ? (spec.optional ? undefined : 0) : spec.integer ? Math.round(Number(e.target.value)) : Number(e.target.value))}
            className={smallInput}
          />
        </div>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-[15px]">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {spec.label}
        </label>
      );
    case "select":
      return (
        <div>
          <label htmlFor={id} className={labelCls}>
            {label}
          </label>
          <select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={smallInput}>
            {(spec.options ?? []).map((o) => (
              <option key={o} value={o}>
                {OPTION_LABELS[o] ?? o}
              </option>
            ))}
          </select>
        </div>
      );
    case "fieldPath": {
      // Ziele (Eigenschaft setzen, KI-Ergebnis) nur aus beschreibbaren Feldern, passend zum Ergebnis
      const isTarget = spec.key === "field" || spec.key === "target";
      let fields = isTarget ? ctx.writable : ctx.available;
      if (nodeType === "ai.classify" && spec.key === "target") fields = fields.filter((f) => f.type === "text" || f.type === "select");
      if (nodeType === "ai.score" && spec.key === "target") fields = fields.filter((f) => f.type === "number" || f.type === "text");
      return (
        <div>
          <FieldPicker label={label} value={String(value ?? "")} onChange={onChange} fields={fields} />
          {isTarget && fields.length === 0 && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Kein passendes Feld – unter „Listen &amp; Felder“ ein eigenes Feld anlegen.</p>}
        </div>
      );
    }
    case "value":
      return (
        <div>
          <span className={labelCls}>{label}</span>
          <ValueInput value={value as string | number | boolean | null | undefined} onChange={onChange} field={ctx.writable.find((f) => f.path === ctx.cfg.field)} />
        </div>
      );
    case "fieldPathList": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-2">
          <legend className={labelCls}>{label}</legend>
          {list.map((v, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <FieldPicker value={v} onChange={(nv) => onChange(list.map((x, j) => (j === i ? nv : x)))} fields={ctx.available} />
              </div>
              <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="mt-1 rounded p-1 text-ink-400 hover:text-red-700" aria-label="Feld entfernen">
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          ))}
          {list.length < 5 && (
            <button type="button" className={btnGhostCls} onClick={() => onChange([...list, ""])}>
              + Feld
            </button>
          )}
        </fieldset>
      );
    }
    case "stringList": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          <label htmlFor={id} className={labelCls}>
            {label} – eine je Zeile
          </label>
          <textarea id={id} rows={4} value={list.join("\n")} onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} className={smallInput} />
        </div>
      );
    }
    case "condition":
      return (
        <div>
          <span className={labelCls}>{label}</span>
          <ConditionRow value={(conditionSchema.safeParse(value).success ? value : { field: "contact.email", op: "is_set" }) as Condition} onChange={onChange} fields={ctx.available} />
        </div>
      );
    case "conditionGroup":
      return (
        <div>
          <span className={labelCls}>{label}</span>
          <ConditionGroupEditor value={(value ?? { match: "all", conditions: [] }) as ConditionGroup} onChange={onChange} fields={ctx.available} />
        </div>
      );
    case "objectList": {
      const list = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      return (
        <fieldset className="space-y-2">
          <legend className={labelCls}>{label}</legend>
          {list.map((item, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-ink-100 p-2.5 dark:border-white/10">
              {(spec.item ?? []).map((sub) =>
                nodeType === "ai.extract" && sub.key === "key" && ctx.cfg.target === "attributes" ? (
                  <AttributeKeyPick
                    key={sub.key}
                    objectType={objectType}
                    writable={ctx.writable}
                    value={String(item[sub.key] ?? "")}
                    onChange={(k, type) => onChange(list.map((x, j) => (j === i ? { ...x, key: k, ...(type ? { type } : {}) } : x)))}
                  />
                ) : (
                  <Field key={sub.key} spec={sub} value={item[sub.key]} nodeType={nodeType} objectType={objectType} options={options} ctx={ctx} onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, [sub.key]: v } : x)))} />
                ),
              )}
              <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => onChange(list.filter((_, j) => j !== i))}>
                Eintrag entfernen
              </button>
            </div>
          ))}
          <button type="button" className={btnGhostCls} onClick={() => onChange([...list, defaultItem(spec)])}>
            + Eintrag
          </button>
        </fieldset>
      );
    }
    default:
      return <p className="text-sm text-ink-400">Feld „{spec.label}“ wird hier nicht unterstützt.</p>;
  }
}

/** Ziel-Feld für „KI: Angaben herauslesen“ – nur vorhandene eigene Felder des Objekts. */
function AttributeKeyPick({ objectType, writable, value, onChange }: { objectType: ObjectType; writable: CatalogField[]; value: string; onChange: (key: string, type?: string) => void }) {
  const id = useId();
  const prefix = `${objectType}.attributes.`;
  const attrs = writable.filter((f) => f.path.startsWith(prefix));
  const known = attrs.some((f) => f.path === prefix + value);
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        Eigenes Feld
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const f = attrs.find((x) => x.path === prefix + e.target.value);
          onChange(e.target.value, f ? (f.type === "select" ? "text" : f.type) : undefined);
        }}
        className={`${smallInput} ${value && !known ? "!border-red-400" : ""}`}
      >
        <option value="">– Feld wählen –</option>
        {value && !known && <option value={value}>⚠ nicht vorhanden: {value}</option>}
        {attrs.map((f) => (
          <option key={f.path} value={f.path.slice(prefix.length)}>
            {f.label}
          </option>
        ))}
      </select>
      {attrs.length === 0 && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Noch keine eigenen Felder – unter „Listen &amp; Felder“ anlegen oder Ziel „nur Zwischenergebnis“ wählen.</p>}
    </div>
  );
}

/** Einstellungen eines Schritts. */
export function NodePanel({
  node,
  def,
  readOnly = false,
  objectType,
  options,
  issues,
  hasErrorBranch,
  isStart,
  onChange,
  onDelete,
  onAddErrorBranch,
}: {
  node: ProcessNode;
  def: ProcessDefinition;
  readOnly?: boolean;
  objectType: ObjectType;
  options: EditorOptions;
  issues: ValidationIssue[];
  hasErrorBranch: boolean;
  isStart: boolean;
  onChange: (n: ProcessNode) => void;
  onDelete: () => void;
  onAddErrorBranch: () => void;
}) {
  const spec = NODE_TYPES[node.type];
  const fields = fieldsFor(node.type);
  const cfg = node.config as Record<string, unknown>;
  const labelId = useId();
  const ctx: FieldCtx = {
    available: availableFields(options.catalog, objectType, def, { kind: "node", nodeId: node.id }),
    writable: writableFields(options.catalog, objectType),
    cfg,
  };
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-200">{spec.group}</div>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{spec.label}</h2>
        {spec.external && <p className="mt-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Außenwirkung: Diese Prozessversion startet erst nach Freigabe durch einen Admin.</p>}
      </div>
      <Help>{NODE_HELP[node.type]}</Help>
      <Issues issues={issues} />
      <div>
        <label htmlFor={labelId} className={labelCls}>
          Eigene Beschriftung (optional)
        </label>
        <input id={labelId} value={node.label ?? ""} maxLength={120} placeholder={spec.label} onChange={(e) => onChange({ ...node, label: e.target.value || undefined })} className={smallInput} />
      </div>
      {fields.length === 1 && fields[0].key === "__group" ? (
        <div>
          <span className={labelCls}>Bedingungen</span>
          <ConditionGroupEditor value={(cfg.conditions ? cfg : { match: "all", conditions: [] }) as ConditionGroup} onChange={(g) => onChange({ ...node, config: g })} fields={ctx.available} emptyText="Noch keine Bedingung – bitte mindestens eine hinzufügen." />
        </div>
      ) : (
        fields.map((f) => (
          <Field
            key={f.key}
            spec={f}
            value={cfg[f.key]}
            nodeType={node.type}
            objectType={objectType}
            options={options}
            ctx={ctx}
            onChange={(v) => {
              const next = { ...cfg };
              if (v === undefined) delete next[f.key];
              else next[f.key] = v;
              onChange({ ...node, config: next });
            }}
          />
        ))
      )}
      <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-3 dark:border-white/10">
        {node.type !== "logic.end" && !hasErrorBranch && (
          <button type="button" className={btnGhostCls} onClick={onAddErrorBranch} title="Was soll passieren, wenn dieser Schritt dauerhaft scheitert?">
            Fehler-Zweig anlegen
          </button>
        )}
        <button
          type="button"
          className={btnDangerCls}
          onClick={() => {
            if (confirm(`Schritt „${node.label || spec.label}“ löschen?${node.type === "logic.if" ? " Der Nein-Zweig wird mit entfernt." : ""}`)) onDelete();
          }}
        >
          <Trash2 size={15} aria-hidden /> Löschen
        </button>
        {isStart && <span className="self-center text-sm text-ink-400 dark:text-ink-200">Erster Schritt</span>}
      </div>
    </fieldset>
  );
}

/** Auslöser, Einschreibungsfilter, erneute Einschreibung und Ziel. */
export function TriggerPanel({ def, objectType, options, onChange, issues, readOnly = false }: { def: ProcessDefinition; objectType: ObjectType; options: EditorOptions; onChange: (d: ProcessDefinition) => void; issues: ValidationIssue[]; readOnly?: boolean }) {
  const ids = { trigger: useId(), cfg: useId(), tags: useId() };
  // Filter und Ziel: Objektfelder + Daten des Auslösers (Zwischenergebnisse gibt es hier noch nicht)
  const triggerFields = availableFields(options.catalog, objectType, def, { kind: "trigger" });
  // „Eigenschaft geändert“: Ereignis meldet den Feldnamen ohne „contact.“
  const contactFields = objectFields(options.catalog, "contact").map((f) => ({ ...f, path: f.path.slice("contact.".length) }));
  const triggers = (Object.entries(TRIGGER_TYPES) as [TriggerType, { label: string; objectType: ObjectType | null }][]).filter(([, t]) => !t.objectType || t.objectType === objectType);
  const cfg = def.trigger.config as Record<string, unknown>;
  const setCfg = (k: string, v: unknown) => {
    const next = { ...cfg };
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
    onChange({ ...def, trigger: { ...def.trigger, config: next } });
  };
  const select = (key: string, opts: Opt[], anyLabel: string, label = "Nur für") => (
    <div key={key}>
      <label htmlFor={`${ids.cfg}-${key}`} className={labelCls}>
        {label}
      </label>
      <select id={`${ids.cfg}-${key}`} value={String(cfg[key] ?? "")} onChange={(e) => setCfg(key, e.target.value)} className={smallInput}>
        <option value="">{anyLabel}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  const t = def.trigger.type;
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-200">Auslöser · {OBJECT_LABELS[objectType]}</div>
        <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-50">Wann startet der Prozess?</h2>
      </div>
      <Issues issues={issues} />
      <div>
        <label htmlFor={ids.trigger} className={labelCls}>
          Auslöser
        </label>
        <select id={ids.trigger} value={t} onChange={(e) => onChange({ ...def, trigger: { type: e.target.value as TriggerType, config: {} } })} className={smallInput}>
          {triggers.map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
      {TRIGGER_HELP[t] && <Help>{TRIGGER_HELP[t]}</Help>}
      {t === "form.submitted" && select("formId", options.forms, "alle Formulare")}
      {t === "contact.list_added" && select("listId", options.lists, "alle Listen")}
      {t === "contact.lifecycle_changed" && select("stage", options.lifecycleStages, "jede Phase")}
      {t === "deal.stage_changed" && select("stageId", options.stages.filter((s) => s.objectType === "deal"), "jede Phase")}
      {t === "ticket.stage_changed" && select("stageId", options.stages.filter((s) => s.objectType === "ticket"), "jeden Status")}
      {t === "email.event" && select("event", CATALOG_EMAIL_EVENTS, "jedes Ereignis")}
      {(t === "meeting.scheduled" || t === "meeting.booked") && select("meetingTypeId", options.catalog.meetingTypes ?? [], "alle Terminvorlagen")}
      {t === "conversation.message_received" && (
        <>
          {select("channel", CHANNELS, "jeder Kanal", "Kanal")}
          {select("inboxId", (options.catalog.inboxes ?? []).filter((i) => !cfg.channel || i.kind === cfg.channel || (cfg.channel === "email" && i.kind.startsWith("email"))), "alle Posteingänge", "Posteingang")}
          <label className="flex items-start gap-2 text-[15px]">
            <input type="checkbox" className="mt-1" checked={cfg.everyMessage === true} onChange={(e) => setCfg("everyMessage", e.target.checked ? true : undefined)} />
            <span>
              Bei jeder eingehenden Nachricht starten
              <span className="block text-sm text-ink-400 dark:text-ink-200">Standard: nur bei einem neuen Gespräch – sonst startet jede Antwort im Verlauf einen Lauf.</span>
            </span>
          </label>
        </>
      )}
      {t === "debit.returned" && select("reason", RETURN_REASON_OPTS, "jeder Rückgabegrund", "Rückgabegrund")}
      {t === "invoice.paid" && select("via", PAID_VIA, "jeder Zahlweg", "Bezahlt über")}
      {t === "contact.tag_added" && (
        <div>
          <label htmlFor={ids.cfg} className={labelCls}>
            Tag (leer = jeder Tag)
          </label>
          <input id={ids.cfg} list={ids.tags} value={String(cfg.tag ?? "")} maxLength={60} onChange={(e) => setCfg("tag", e.target.value.trim())} className={smallInput} />
          <datalist id={ids.tags}>
            {options.catalog.tags.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </div>
      )}
      {t === "contact.property_changed" && (
        <FieldPicker label="Feld" emptyLabel="– jedes Feld –" value={String(cfg.field ?? "")} onChange={(v) => setCfg("field", v)} fields={contactFields} />
      )}

      <section>
        <h3 className="mb-1 text-[15px] font-semibold">Nur einschreiben, wenn …</h3>
        <ConditionGroupEditor
          value={def.enrollment.filters}
          onChange={(filters) => onChange({ ...def, enrollment: { ...def.enrollment, filters } })}
          fields={triggerFields}
          emptyText="Keine Filter – jeder passende Datensatz wird eingeschrieben."
        />
      </section>
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" className="mt-1" checked={def.enrollment.reenroll} onChange={(e) => onChange({ ...def, enrollment: { ...def.enrollment, reenroll: e.target.checked } })} />
        <span>
          Erneut einschreiben erlauben
          <span className="block text-sm text-ink-400 dark:text-ink-200">Ein Datensatz kann nach Ende seines Laufs wieder starten, wenn der Auslöser erneut eintritt.</span>
        </span>
      </label>
      <section>
        <label className="flex items-start gap-2 text-[15px]">
          <input type="checkbox" className="mt-1" checked={Boolean(def.goal)} onChange={(e) => onChange({ ...def, goal: e.target.checked ? { match: "all", conditions: [] } : undefined })} />
          <span>
            Ziel festlegen
            <span className="block text-sm text-ink-400 dark:text-ink-200">Ist das Ziel erreicht (z. B. Deal gewonnen), endet der Lauf vorzeitig.</span>
          </span>
        </label>
        {def.goal && (
          <div className="mt-2">
            <ConditionGroupEditor value={def.goal} onChange={(goal) => onChange({ ...def, goal })} fields={triggerFields} emptyText="Bitte mindestens eine Ziel-Bedingung angeben." />
          </div>
        )}
      </section>
    </fieldset>
  );
}

export { Issues };

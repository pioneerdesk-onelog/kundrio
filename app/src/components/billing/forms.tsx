"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";

export type FormState = { error?: string; ok?: string };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Status({ state }: { state: FormState }) {
  return (
    <>
      {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{state.ok}</p>}
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error}</p>}
    </>
  );
}

/** Formular mit Inline-Rückmeldung für eine (gebundene) Server Action. */
export function StateForm({ action, submit, children, ghost, className = "space-y-3", confirm }: { action: Action; submit: string; children?: ReactNode; ghost?: boolean; className?: string; confirm?: string }) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  // Nur nach Erfolg leeren – bei einem Fehler bleiben die Eingaben stehen (React setzt <form action> sonst immer zurück)
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
    >
      {children}
      <button className={ghost ? btnGhostCls : btnCls} disabled={pending}>{pending ? "Bitte warten …" : submit}</button>
      <Status state={state} />
    </form>
  );
}

type Product = { id: string; name: string; unitCents: number; vatRate: number; interval: string };
type Option = { id: string; label: string };
type Mandate = { id: string; contactId: string; label: string };
type Item = { title: string; qty: number; unitCents: number; vatRate: 19 | 7 | 0; unit: "C62" | "HUR" | "DAY" | "MON" };

const euro = (c: number) => (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

/** Abo anlegen: Kontakt, Positionen aus dem Produktkatalog, Laufzeit, Zahlungsweg. */
export function SubscriptionForm({ action, contacts, products, mandates, today }: { action: Action; contacts: Option[]; products: Product[]; mandates: Mandate[]; today: string }) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  const [contactId, setContactId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [interval, setBillingInterval] = useState("monthly");
  const [method, setMethod] = useState("transfer");
  const [consumer, setConsumer] = useState(false);
  const myMandates = useMemo(() => mandates.filter((m) => m.contactId === contactId), [mandates, contactId]);
  const total = items.reduce((s, i) => s + Math.round(i.qty * i.unitCents * (1 + i.vatRate / 100)), 0);

  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setItems((l) => [...l, { title: p.name, qty: 1, unitCents: p.unitCents, vatRate: (p.vatRate as 19 | 7 | 0) ?? 19, unit: p.interval === "one_time" ? "C62" : "MON" }]);
    if (p.interval !== "one_time") setBillingInterval(p.interval);
  };

  return (
    <form action={run} className="space-y-5">
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contactId" className={labelCls}>Kunde (Kontakt)</label>
          <select id="contactId" name="contactId" required className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">– wählen –</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="startDate" className={labelCls}>Beginn (erste Abrechnung)</label>
          <input id="startDate" name="startDate" type="date" required defaultValue={today} className={inputCls} />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelCls}>Positionen</legend>
        <select aria-label="Produkt hinzufügen" className={inputCls} value="" onChange={(e) => addProduct(e.target.value)}>
          <option value="">+ Produkt aus dem Katalog hinzufügen …</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} – {euro(p.unitCents)} netto</option>)}
        </select>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2">
            <input aria-label="Text" className={inputCls} value={it.title} onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <input aria-label="Menge" type="number" min="0.01" step="0.01" className={inputCls} value={it.qty} onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} />
            <input aria-label="Preis netto in Euro" type="number" step="0.01" className={inputCls} value={it.unitCents / 100} onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, unitCents: Math.round(Number(e.target.value) * 100) } : x)))} />
            <button type="button" className={btnGhostCls} onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label={`Position ${it.title} entfernen`}>Entfernen</button>
          </div>
        ))}
        {items.length > 0 && <p className="text-sm text-ink-600 dark:text-ink-200">Je Abrechnung brutto: <strong>{euro(total)}</strong></p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="interval" className={labelCls}>Abrechnung</label>
          <select id="interval" name="interval" className={inputCls} value={interval} onChange={(e) => setBillingInterval(e.target.value)}>
            <option value="monthly">monatlich</option>
            <option value="quarterly">vierteljährlich</option>
            <option value="yearly">jährlich</option>
            <option value="one_time">einmalig</option>
          </select>
        </div>
        <div>
          <label htmlFor="minTermMonths" className={labelCls}>Mindestlaufzeit (Monate)</label>
          <input id="minTermMonths" name="minTermMonths" type="number" min={0} max={consumer ? 24 : 60} defaultValue={12} className={inputCls} />
        </div>
        <div>
          <label htmlFor="noticePeriodDays" className={labelCls}>Kündigungsfrist (Tage)</label>
          <input id="noticePeriodDays" name="noticePeriodDays" type="number" min={0} max={consumer ? 30 : 365} defaultValue={30} className={inputCls} />
        </div>
      </div>

      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" name="consumer" checked={consumer} onChange={(e) => setConsumer(e.target.checked)} className="mt-1" />
        <span>
          Verbraucher (B2C)
          <span className="block text-sm text-ink-400 dark:text-ink-200">Mindestlaufzeit höchstens 24 Monate, danach jederzeit mit höchstens einem Monat kündbar (§ 309 Nr. 9 BGB); Kündigungsbutton im Kundenportal (§ 312k BGB).</span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="paymentMethod" className={labelCls}>Zahlungsweg</label>
          <select id="paymentMethod" name="paymentMethod" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="transfer">Überweisung</option>
            <option value="sepa">SEPA-Lastschrift</option>
          </select>
        </div>
        {method === "sepa" && (
          <div>
            <label htmlFor="mandateId" className={labelCls}>Mandat</label>
            <select id="mandateId" name="mandateId" required className={inputCls}>
              <option value="">{myMandates.length ? "– wählen –" : "Kein aktives Mandat für diesen Kontakt"}</option>
              {myMandates.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <button className={btnCls} disabled={pending || !items.length}>{pending ? "Bitte warten …" : "Abo anlegen"}</button>
      <Status state={state} />
    </form>
  );
}

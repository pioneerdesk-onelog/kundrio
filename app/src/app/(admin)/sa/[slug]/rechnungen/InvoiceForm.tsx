"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { computeTotals, formatCents, UNIT_LABEL, type InvoiceItem } from "@/lib/invoice";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { InvoiceState } from "./actions";

type Contact = { id: string; name: string; email: string | null; company: string | null };
type Initial = {
  kind: "QUOTE" | "ORDER" | "INVOICE"; contactId: string | null; issueDate: string; dueDate: string; buyerName: string;
  buyerAddress: string; buyerReference: string; notes: string; items: InvoiceItem[];
  buyerEmail: string; serviceFrom: string; serviceTo: string; taxExemptionReason: string;
  customerOrderRef?: string; introText?: string; outroText?: string;
};

/** Standardtexte (bereits mit Platzhaltern) zur Anzeige als Vorlage im Formular. */
type DefaultTexts = { intro: string; outro: string };

type Row = { title: string; qty: string; unit: string; price: string; vatRate: string };

const toRow = (i: InvoiceItem): Row => ({ title: i.title, qty: String(i.qty).replace(".", ","), unit: i.unit, price: (i.unitCents / 100).toFixed(2).replace(".", ","), vatRate: String(i.vatRate) });
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

function toItem(r: Row): InvoiceItem | null {
  const qty = num(r.qty);
  const price = num(r.price);
  if (!r.title.trim() || !Number.isFinite(qty) || !Number.isFinite(price)) return null;
  return { title: r.title.trim(), qty, unitCents: Math.round(price * 100), vatRate: Number(r.vatRate) as 19 | 7 | 0, unit: r.unit as InvoiceItem["unit"] };
}

export function InvoiceForm({ action, initial, contacts, locked, isEdit = false, defaultTexts }: { action: (s: InvoiceState, f: FormData) => Promise<InvoiceState>; initial: Initial; contacts: Contact[]; locked: boolean; isEdit?: boolean; defaultTexts?: DefaultTexts }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [rows, setRows] = useState<Row[]>(initial.items.length ? initial.items.map(toRow) : [{ title: "", qty: "1", unit: "C62", price: "", vatRate: "19" }]);
  const [buyerName, setBuyerName] = useState(initial.buyerName);
  const [buyerEmail, setBuyerEmail] = useState(initial.buyerEmail);
  const items = useMemo(() => rows.map(toItem).filter((x): x is InvoiceItem => !!x && x.qty > 0), [rows]);
  const totals = computeTotals(items);
  const hasZeroVat = items.some((it) => it.vatRate === 0);
  const [introDefault, setIntroDefault] = useState(!initial.introText);
  const [outroDefault, setOutroDefault] = useState(!initial.outroText);
  const [intro, setIntro] = useState(initial.introText || defaultTexts?.intro || "");
  const [outro, setOutro] = useState(initial.outroText || defaultTexts?.outro || "");
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <fieldset disabled={locked || pending} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {isEdit ? (
            // Die Art ist nach dem Anlegen fest (Nummernkreis); Angebot → Rechnung über „In Rechnung umwandeln“
            <input type="hidden" name="kind" value={initial.kind} />
          ) : (
            <div>
              <label htmlFor="kind" className={labelCls}>Art</label>
              <select id="kind" name="kind" defaultValue={initial.kind} className={inputCls}>
                <option value="QUOTE">Angebot</option>
                <option value="INVOICE">Rechnung</option>
              </select>
            </div>
          )}
          <div>
            <label htmlFor="issueDate" className={labelCls}>Datum</label>
            <input id="issueDate" name="issueDate" type="date" required defaultValue={initial.issueDate} className={inputCls} />
          </div>
          <div>
            {initial.kind === "ORDER" ? (
              <>
                <label htmlFor="customerOrderRef" className={labelCls}>Ihre Bestell-/Referenznummer (Kunde)</label>
                <input id="customerOrderRef" name="customerOrderRef" maxLength={100} defaultValue={initial.customerOrderRef ?? ""} className={inputCls} />
                <input type="hidden" name="dueDate" value="" />
              </>
            ) : (
              <>
                <label htmlFor="dueDate" className={labelCls}>{initial.kind === "QUOTE" ? "Gültig bis" : "Fällig am"}</label>
                <input id="dueDate" name="dueDate" type="date" defaultValue={initial.dueDate} className={inputCls} />
              </>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contactId" className={labelCls}>Kontakt</label>
            <select
              id="contactId"
              name="contactId"
              defaultValue={initial.contactId ?? ""}
              onChange={(e) => {
                const c = contacts.find((x) => x.id === e.target.value);
                if (c && !buyerName) setBuyerName(c.company || c.name);
                if (c?.email && !buyerEmail) setBuyerEmail(c.email);
              }}
              className={inputCls}
            >
              <option value="">– ohne Kontakt –</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.company ? `${c.company} (${c.name})` : c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="buyerEmail" className={labelCls}>E-Mail des Empfängers</label>
            <input id="buyerEmail" name="buyerEmail" type="email" maxLength={254} value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} className={inputCls} />
            <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Elektronische Adresse in der XRechnung (BT-49); wird aus dem Kontakt vorbelegt.</p>
          </div>
          <div>
            <label htmlFor="buyerName" className={labelCls}>Empfänger (Firma/Name)</label>
            <input id="buyerName" name="buyerName" required maxLength={200} value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="buyerAddress" className={labelCls}>Anschrift des Empfängers</label>
            <textarea id="buyerAddress" name="buyerAddress" rows={3} maxLength={500} defaultValue={initial.buyerAddress} placeholder={"Straße 1\n12345 Ort"} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="serviceFrom" className={labelCls}>Leistung von</label>
              <input id="serviceFrom" name="serviceFrom" type="date" defaultValue={initial.serviceFrom} className={inputCls} />
            </div>
            <div>
              <label htmlFor="serviceTo" className={labelCls}>Leistung bis</label>
              <input id="serviceTo" name="serviceTo" type="date" defaultValue={initial.serviceTo} className={inputCls} />
            </div>
            <p className="col-span-2 -mt-1 text-sm text-ink-400 dark:text-ink-200">Leer = Leistungsdatum gleich Belegdatum; nur „von“ = einzelnes Leistungsdatum.</p>
          </div>
          <div>
            <label htmlFor="buyerReference" className={labelCls}>Käuferreferenz / Leitweg-ID</label>
            <input id="buyerReference" name="buyerReference" maxLength={100} defaultValue={initial.buyerReference} className={inputCls} />
            <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">Pflicht für XRechnung (bei Behörden die Leitweg-ID).</p>
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-display text-xl">Positionen</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[15px]">
              <thead className="text-sm text-ink-400"><tr><th className="py-1">Leistung</th><th className="w-24">Menge</th><th className="w-28">Einheit</th><th className="w-32">Einzelpreis €</th><th className="w-24">USt</th><th className="w-28 text-right">Netto</th><th className="w-10" /></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const it = toItem(r);
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-1 pr-2"><input aria-label={`Position ${i + 1} Leistung`} value={r.title} onChange={(e) => set(i, "title", e.target.value)} className={inputCls} maxLength={300} /></td>
                      <td className="pr-2"><input aria-label={`Position ${i + 1} Menge`} inputMode="decimal" value={r.qty} onChange={(e) => set(i, "qty", e.target.value)} className={inputCls} /></td>
                      <td className="pr-2">
                        <select aria-label={`Position ${i + 1} Einheit`} value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} className={inputCls}>
                          {Object.entries(UNIT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="pr-2"><input aria-label={`Position ${i + 1} Einzelpreis`} inputMode="decimal" value={r.price} onChange={(e) => set(i, "price", e.target.value)} className={inputCls} placeholder="0,00" /></td>
                      <td className="pr-2">
                        <select aria-label={`Position ${i + 1} Umsatzsteuer`} value={r.vatRate} onChange={(e) => set(i, "vatRate", e.target.value)} className={inputCls}>
                          <option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option>
                        </select>
                      </td>
                      <td className="pt-2 text-right tabular-nums">{it ? formatCents(Math.round(it.qty * it.unitCents)) : "–"}</td>
                      <td className="pl-1"><button type="button" aria-label={`Position ${i + 1} entfernen`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-2 text-ink-400 hover:bg-sand-100 hover:text-red-700"><Trash2 size={16} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setRows((rs) => [...rs, { title: "", qty: "1", unit: "C62", price: "", vatRate: "19" }])} className={`${btnGhostCls} mt-2`}><Plus size={16} aria-hidden /> Position</button>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-[15px]">
            <div className="flex justify-between"><dt>Netto</dt><dd className="tabular-nums">{formatCents(totals.netCents)}</dd></div>
            {totals.vatGroups.map((g) => <div key={g.rate} className="flex justify-between text-ink-600 dark:text-ink-200"><dt>USt {g.rate} %</dt><dd className="tabular-nums">{formatCents(g.vatCents)}</dd></div>)}
            <div className="flex justify-between border-t border-ink-200 pt-1 font-semibold"><dt>Gesamt</dt><dd className="tabular-nums">{formatCents(totals.grossCents)}</dd></div>
          </dl>
        </div>

        {(hasZeroVat || initial.taxExemptionReason) && (
          <div>
            <label htmlFor="taxExemptionReason" className={labelCls}>Grund der Steuerbefreiung (bei 0 % Pflicht)</label>
            <input id="taxExemptionReason" name="taxExemptionReason" maxLength={300} defaultValue={initial.taxExemptionReason} placeholder="z. B. Steuerfreie Leistung nach § 4 Nr. 21 UStG" className={inputCls} required={hasZeroVat} />
          </div>
        )}

        {initial.kind !== "ORDER" && <input type="hidden" name="customerOrderRef" value={initial.customerOrderRef ?? ""} />}
        <fieldset className="space-y-4 rounded-lg border border-ink-100 p-4 dark:border-white/10">
          <legend className="px-1 font-display text-lg">Texte auf dem Beleg</legend>
          <p className="text-sm text-ink-400 dark:text-ink-200">
            Standardtexte stammen aus „Texte &amp; Vorlagen“. Platzhalter wie {"{{ kunde.ansprechpartner }}"} werden beim Erstellen von PDF und E-Mail gefüllt.
          </p>
          {([
            ["intro", "Einleitung", intro, setIntro, introDefault, setIntroDefault],
            ["outro", "Schlusstext", outro, setOutro, outroDefault, setOutroDefault],
          ] as const).map(([key, label, val, setVal, useDef, setUseDef]) => (
            <div key={key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`${key}Text`} className={labelCls}>{label}</label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`${key}Default`} checked={useDef} onChange={(e) => setUseDef(e.target.checked)} />
                  Standardtext verwenden
                </label>
              </div>
              <textarea id={`${key}Text`} name={`${key}Text`} rows={4} maxLength={4000} value={val} onChange={(e) => setVal(e.target.value)} disabled={useDef} className={`${inputCls} ${useDef ? "opacity-60" : ""}`} />
            </div>
          ))}
        </fieldset>

        <div>
          <label htmlFor="notes" className={labelCls}>Hinweise (erscheinen auf dem Beleg)</label>
          <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={initial.notes} className={inputCls} placeholder="z. B. Zahlungsbedingungen" />
        </div>
      </fieldset>
      {!locked && (
        <div className="flex items-center gap-3">
          <button className={btnCls} disabled={pending}>{pending ? "Speichern …" : "Speichern"}</button>
          {state.error && <p role="alert" className="text-red-700 dark:text-red-300">{state.error}</p>}
        </div>
      )}
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import type { BrandState } from "@/app/(admin)/sa/[slug]/einstellungen/brand-actions";
import { COLOR_ROLES, COLOR_ROLE_LABELS, type BrandGuide } from "@/lib/brand/guide";

function Status({ state }: { state: BrandState }) {
  return (
    <p role="status" aria-live="polite" className={`text-sm ${state.error ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

/** Website-CI auswerten (Domain vorbelegt). */
export function WebsiteForm({ action, domain }: { action: (s: BrandState, f: FormData) => Promise<BrandState>; domain: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="brand-domain" className={labelCls}>Domain</label>
        <input id="brand-domain" name="domain" defaultValue={domain ?? ""} placeholder="beispiel.de" className={inputCls} required />
      </div>
      <p className="text-sm text-ink-400 dark:text-ink-200">Liest Startseite und Stylesheets: Farben, Schriften, Logo und den Ton der Texte. Ergebnisse kommen als Vorschläge.</p>
      <button className={btnCls} disabled={pending}>{pending ? "Startet …" : "Website auswerten"}</button>
      <Status state={state} />
    </form>
  );
}

type ColorRow = { name: string; hex: string; role: string };

/** Manuelle Pflege des Leitfadens – alles oder nur Teile. */
export function ManualForm({ action, guide }: { action: (s: BrandState, f: FormData) => Promise<BrandState>; guide: BrandGuide }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [colors, setColors] = useState<ColorRow[]>(
    guide.colors?.length ? guide.colors.map((c) => ({ name: c.name, hex: c.hex, role: c.role })) : [{ name: "", hex: "#0b4f6c", role: "primary" }],
  );
  const lines = (arr?: { text: string }[]) => (arr ?? []).map((x) => x.text).join("\n");
  return (
    <form action={formAction} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className={labelCls}>Farben</legend>
        {colors.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="color" name="colorHex" value={c.hex} aria-label={`Farbe ${i + 1}`} onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} className="h-9 w-12 shrink-0 rounded border border-ink-200" />
            <input name="colorName" value={c.name} placeholder="Name, z. B. Petrol" aria-label={`Name Farbe ${i + 1}`} onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${inputCls} min-w-0`} maxLength={60} />
            <select name="colorRole" value={c.role} aria-label={`Rolle Farbe ${i + 1}`} onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} className={`${inputCls.replace("w-full", "")} w-36 shrink-0`}>
              {COLOR_ROLES.map((r) => (
                <option key={r} value={r}>{COLOR_ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button type="button" aria-label={`Farbe ${i + 1} entfernen`} className="rounded p-1 text-ink-400 hover:text-red-700" onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))}>
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
        {colors.length < 24 && (
          <button type="button" className={btnGhostCls} onClick={() => setColors((cs) => [...cs, { name: "", hex: "#888888", role: "other" }])}>
            <Plus size={15} aria-hidden /> Farbe
          </button>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="typo-h" className={labelCls}>Schrift Überschriften</label>
          <input id="typo-h" name="typoHeading" defaultValue={guide.typography?.heading ?? ""} className={inputCls} maxLength={80} />
        </div>
        <div>
          <label htmlFor="typo-b" className={labelCls}>Schrift Fließtext</label>
          <input id="typo-b" name="typoBody" defaultValue={guide.typography?.body ?? ""} className={inputCls} maxLength={80} />
        </div>
      </div>

      <div>
        <label htmlFor="voice" className={labelCls}>Markenstimme (2–3 Sätze)</label>
        <textarea id="voice" name="voice" rows={3} defaultValue={guide.voice?.summary ?? ""} className={inputCls} maxLength={1200} />
      </div>
      <div>
        <label htmlFor="adjectives" className={labelCls}>Eigenschaften (eine je Zeile)</label>
        <textarea id="adjectives" name="adjectives" rows={2} defaultValue={(guide.voice?.adjectives ?? []).join("\n")} className={inputCls} placeholder={"klar\nsachlich\nnahbar"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="do" className={labelCls}>Do&apos;s (eine je Zeile)</label>
          <textarea id="do" name="do" rows={4} defaultValue={lines(guide.doAndDont?.do)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="dont" className={labelCls}>Don&apos;ts (eine je Zeile)</label>
          <textarea id="dont" name="dont" rows={4} defaultValue={lines(guide.doAndDont?.dont)} className={inputCls} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="address" className={labelCls}>Anrede</label>
          <select id="address" name="address" defaultValue={guide.writingRules?.address ?? "unklar"} className={inputCls}>
            <option value="sie">Sie</option>
            <option value="du">Du</option>
            <option value="unklar">nicht festgelegt</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="gender" className={labelCls}>Gendern</label>
          <input id="gender" name="gender" defaultValue={guide.writingRules?.gender ?? ""} placeholder="z. B. Doppelpunkt (Kund:innen) oder neutrale Formen" className={inputCls} maxLength={200} />
        </div>
      </div>
      <div>
        <label htmlFor="terms" className={labelCls}>Begriffe & Schreibweisen (eine je Zeile)</label>
        <textarea id="terms" name="terms" rows={3} defaultValue={(guide.writingRules?.terms ?? []).join("\n")} className={inputCls} placeholder={"OneLog (nicht: Onelog)\nE-Mail (nicht: Email)"} />
      </div>
      <div>
        <label htmlFor="logoRules" className={labelCls}>Logo-Regeln (eine je Zeile)</label>
        <textarea id="logoRules" name="logoRules" rows={2} defaultValue={lines(guide.logoRules)} className={inputCls} placeholder="Schutzraum mindestens Höhe des Signets" />
      </div>
      <button className={btnCls} disabled={pending}>{pending ? "Speichern …" : "Leitfaden speichern"}</button>
      <Status state={state} />
    </form>
  );
}

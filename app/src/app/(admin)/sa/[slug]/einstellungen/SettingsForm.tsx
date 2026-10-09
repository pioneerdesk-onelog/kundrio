"use client";

import { useActionState, useState } from "react";
import { contrastRatio } from "@/lib/compliance-validators";
import { Badge, btnCls, inputCls, labelCls } from "@/components/ui";
import type { SettingsState } from "./actions";

type WS = {
  name: string; domain: string | null; description: string | null; mailFromName: string | null; mailFromEmail: string | null;
  brandPrimary: string; brandAccent: string; fontHeading: string; fontBody: string; region: string; languages: string[];
  allowedOrigins: string[]; legalName: string | null; legalAddress: string | null; vatId: string | null; iban: string | null;
  legalPhone: string | null; legalEmail: string | null; agentApiEnabled: boolean;
  bic: string | null; imprint: string | null; slug: string;
};

const LANGS: [string, string][] = [["de", "Deutsch"], ["en", "Englisch"], ["pl", "Polnisch"], ["uk", "Ukrainisch"], ["tr", "Türkisch"], ["ar", "Arabisch"], ["fr", "Französisch"], ["it", "Italienisch"], ["es", "Spanisch"], ["nl", "Niederländisch"], ["ro", "Rumänisch"]];
const FONTS = [["Newsreader", "Newsreader (Serif)"], ["Inter", "Inter (Sans)"], ["System", "Systemschrift"]];

function Contrast({ color }: { color: string }) {
  let ratio = 0;
  try {
    ratio = contrastRatio(color, "#ffffff");
  } catch {
    return null;
  }
  const tone = ratio >= 4.5 ? "ok" : ratio >= 3 ? "warn" : "bad";
  const text = ratio >= 4.5 ? "AA für Text" : ratio >= 3 ? "nur große Schrift/Flächen" : "zu wenig Kontrast";
  return <Badge tone={tone}>Kontrast zu Weiß {ratio.toFixed(1)}:1 · {text}</Badge>;
}

function Field({ name, label, error, children, hint }: { name: string; label: string; error?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={name} className={labelCls}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-sm text-ink-400 dark:text-ink-200">{hint}</p>}
      {error && <p id={`${name}-err`} className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

export function SettingsForm({ ws, action, canEdit }: { ws: WS; action: (s: SettingsState, f: FormData) => Promise<SettingsState>; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [primary, setPrimary] = useState(ws.brandPrimary);
  const [accent, setAccent] = useState(ws.brandAccent);
  const f = state.fields ?? {};
  const inv = (k: string) => (f[k] ? { "aria-invalid": true, "aria-describedby": `${k}-err` } : {});

  return (
    <form action={formAction} className="space-y-8">
      <fieldset disabled={!canEdit || pending} className="space-y-8">
        <section className="space-y-4">
          <h2 className="font-display text-xl">Allgemein</h2>
          <Field name="name" label="Name" error={f.name}><input id="name" name="name" required maxLength={80} defaultValue={ws.name} className={inputCls} {...inv("name")} /></Field>
          <Field name="domain" label="Domain" error={f.domain}><input id="domain" name="domain" maxLength={253} defaultValue={ws.domain ?? ""} placeholder="beispiel.de" className={inputCls} {...inv("domain")} /></Field>
          <Field name="description" label="Beschreibung" error={f.description}><textarea id="description" name="description" maxLength={500} rows={2} defaultValue={ws.description ?? ""} className={inputCls} /></Field>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl">Branding</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="brandPrimary" label="Primärfarbe" error={f.brandPrimary}>
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Primärfarbe wählen" value={primary} onChange={(e) => setPrimary(e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded border border-ink-200" />
                <input id="brandPrimary" name="brandPrimary" value={primary} onChange={(e) => setPrimary(e.target.value)} pattern="#[0-9a-fA-F]{6}" className={`${inputCls} max-w-32 font-mono`} />
              </div>
              <div className="mt-2"><Contrast color={primary} /></div>
            </Field>
            <Field name="brandAccent" label="Akzentfarbe" error={f.brandAccent} hint="Für Flächen und Hervorhebungen.">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Akzentfarbe wählen" value={accent} onChange={(e) => setAccent(e.target.value.toUpperCase())} className="h-10 w-14 cursor-pointer rounded border border-ink-200" />
                <input id="brandAccent" name="brandAccent" value={accent} onChange={(e) => setAccent(e.target.value)} pattern="#[0-9a-fA-F]{6}" className={`${inputCls} max-w-32 font-mono`} />
              </div>
            </Field>
          </div>
          <div className="rounded-lg border border-ink-100 p-4 dark:border-white/10" style={{ background: accent }}>
            <span className="inline-block rounded-md px-3 py-2 text-sm font-medium text-white" style={{ background: primary }}>Vorschau: Schaltfläche</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="fontHeading" label="Schrift Überschriften">
              <select id="fontHeading" name="fontHeading" defaultValue={ws.fontHeading} className={inputCls}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
            <Field name="fontBody" label="Schrift Fließtext">
              <select id="fontBody" name="fontBody" defaultValue={ws.fontBody} className={inputCls}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl">E-Mail-Absender</h2>
          <Field name="mailFromName" label="Absendername" error={f.mailFromName}><input id="mailFromName" name="mailFromName" maxLength={80} defaultValue={ws.mailFromName ?? ""} className={inputCls} {...inv("mailFromName")} /></Field>
          <Field name="mailFromEmail" label="Absenderadresse" error={f.mailFromEmail} hint="Für echten Versand muss die Domain per SPF/DKIM/DMARC freigegeben sein (siehe Pflichten).">
            <input id="mailFromEmail" name="mailFromEmail" type="email" maxLength={254} defaultValue={ws.mailFromEmail ?? ""} className={inputCls} {...inv("mailFromEmail")} />
          </Field>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl">Souveränität &amp; Sprachen</h2>
          <Field name="region" label="Datenregion" hint="DE: Daten und Verbindungen nur in Deutschland. EU: innerhalb der EU.">
            <select id="region" name="region" defaultValue={ws.region} className={`${inputCls} max-w-xs`}>
              <option value="DE">Deutschland (DE)</option>
              <option value="EU">Europäische Union (EU)</option>
            </select>
          </Field>
          <fieldset>
            <legend className={labelCls}>Sprachen der Landingpages</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {LANGS.map(([code, label]) => (
                <label key={code} className="flex items-center gap-2 text-[15px]">
                  <input type="checkbox" name="languages" value={code} defaultChecked={ws.languages.includes(code)} className="h-4 w-4 accent-accent-500" />
                  {label}
                </label>
              ))}
            </div>
            {f.languages && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{f.languages}</p>}
          </fieldset>
          <Field name="allowedOrigins" label="Erlaubte Domains (Tracking-Snippet, Agent-API)" error={f.allowedOrigins} hint="Eine https-Adresse pro Zeile, ohne Pfad, z. B. https://onelog.pro">
            <textarea id="allowedOrigins" name="allowedOrigins" rows={3} defaultValue={ws.allowedOrigins.join("\n")} className={`${inputCls} font-mono`} {...inv("allowedOrigins")} />
          </Field>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="agentApiEnabled" defaultChecked={ws.agentApiEnabled} className="mt-1 h-4 w-4 accent-accent-500" />
            <span>
              <span className="block font-medium">Agent-Schnittstelle für KI-Assistenten aktiv</span>
              <span className="block text-sm text-ink-400 dark:text-ink-200">
                Unter /api/agent/{ws.slug} können KI-Assistenten (z. B. ChatGPT oder Claude im Auftrag eines Kunden) Fragen stellen und
                Anfragen übermitteln. Antworten stammen nur aus Wissensquellen, die als „öffentlich für KI-Agenten“ markiert sind;
                Anfragen bearbeitet ein Mensch. Ausgeschaltet antworten alle Agent-Endpunkte mit 404.
              </span>
            </span>
          </label>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl">Firmendaten (Impressum &amp; Rechnungen)</h2>
          <Field name="legalName" label="Firmenname" error={f.legalName}><input id="legalName" name="legalName" maxLength={200} defaultValue={ws.legalName ?? ""} className={inputCls} /></Field>
          <Field name="legalAddress" label="Anschrift" hint="Straße, darunter PLZ und Ort, optional Ländercode (DE)." error={f.legalAddress}>
            <textarea id="legalAddress" name="legalAddress" rows={3} maxLength={500} defaultValue={ws.legalAddress ?? ""} className={inputCls} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="legalPhone" label="Telefon" error={f.legalPhone} hint="Pflicht für XRechnung (Verkäufer-Kontakt).">
              <input id="legalPhone" name="legalPhone" type="tel" maxLength={40} defaultValue={ws.legalPhone ?? ""} placeholder="+49 89 123456" className={inputCls} {...inv("legalPhone")} />
            </Field>
            <Field name="legalEmail" label="E-Mail für Rechnungen" error={f.legalEmail} hint="Pflicht für XRechnung (Verkäufer-Kontakt).">
              <input id="legalEmail" name="legalEmail" type="email" maxLength={254} defaultValue={ws.legalEmail ?? ""} className={inputCls} {...inv("legalEmail")} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="vatId" label="USt-IdNr." error={f.vatId}><input id="vatId" name="vatId" maxLength={20} defaultValue={ws.vatId ?? ""} placeholder="DE123456789" className={inputCls} {...inv("vatId")} /></Field>
            <Field name="iban" label="IBAN" error={f.iban}><input id="iban" name="iban" maxLength={42} defaultValue={ws.iban ?? ""} className={`${inputCls} font-mono`} {...inv("iban")} /></Field>
            <Field name="bic" label="BIC" error={f.bic}><input id="bic" name="bic" maxLength={11} defaultValue={ws.bic ?? ""} className={`${inputCls} font-mono`} {...inv("bic")} /></Field>
          </div>
          <Field name="imprint" label="Impressum (Markdown)" hint="Erscheint im Fuß von Landingpages und E-Mails.">
            <textarea id="imprint" name="imprint" rows={6} maxLength={5000} defaultValue={ws.imprint ?? ""} className={`${inputCls} font-mono text-sm`} />
          </Field>
        </section>
      </fieldset>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-ink-100 bg-sand-50/95 py-3 backdrop-blur dark:border-white/10 dark:bg-ink-900/95">
        {canEdit ? <button className={btnCls} disabled={pending}>{pending ? "Speichern …" : "Speichern"}</button> : <p className="text-ink-600">Nur Administratoren können Einstellungen ändern.</p>}
        <p role="status" aria-live="polite" className={state.error ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}>{state.error ?? state.ok}</p>
      </div>
    </form>
  );
}

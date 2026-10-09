"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { ASSIGNMENT_MODES, type InboxConfig } from "@/lib/inbox/config";
import type { SettingsState } from "./actions";

function Submit({ children, ghost }: { children: React.ReactNode; ghost?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={ghost ? btnGhostCls : btnCls} disabled={pending}>{pending ? "Bitte warten …" : children}</button>;
}

function Msg({ s }: { s: SettingsState }) {
  if (s.error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{s.error}</p>;
  if (s.ok) return <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{s.ok}</p>;
  return null;
}

type Initial = { name: string; address: string; config: InboxConfig; hasPassword: boolean } | null;

export function EmailInboxForm({ action, initial, users }: { action: (p: SettingsState, fd: FormData) => Promise<SettingsState>; initial: Initial; users: { id: string; name: string }[] }) {
  const [state, run] = useActionState(action, {});
  const c = initial?.config ?? ({ assignment: "manual", assigneeIds: [] } as InboxConfig);
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input name={name} className={inputCls} {...props} />
    </label>
  );
  return (
    <form action={run} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Name (z. B. Support)", { required: true, defaultValue: initial?.name ?? "" })}
        {field("address", "E-Mail-Adresse", { required: true, type: "email", defaultValue: initial?.address ?? "" })}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">Empfang (IMAP)</legend>
        {field("imapHost", "Server", { required: true, defaultValue: c.imapHost ?? "", placeholder: "imap.example.de" })}
        {field("imapPort", "Port", { type: "number", defaultValue: String(c.imapPort ?? 993) })}
        {field("folder", "Ordner", { defaultValue: c.folder ?? "INBOX" })}
        {field("imapUser", "Benutzer (leer = Adresse)", { defaultValue: c.imapUser ?? "", autoComplete: "off" })}
        {field("imapPassword", initial?.hasPassword ? "Passwort (leer = unverändert)" : "Passwort / App-Passwort", { type: "password", autoComplete: "new-password", required: !initial?.hasPassword })}
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="imapSecure" defaultChecked={c.imapSecure ?? true} /> TLS (SSL)</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="markSeen" defaultChecked={c.markSeen ?? false} /> Abgerufene als gelesen markieren</label>
        </div>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-semibold">Versand (SMTP)</legend>
        {field("smtpHost", "Server", { required: true, defaultValue: c.smtpHost ?? "", placeholder: "smtp.example.de" })}
        {field("smtpPort", "Port", { type: "number", defaultValue: String(c.smtpPort ?? 587) })}
        {field("fromName", "Absendername", { defaultValue: c.fromName ?? "" })}
        {field("smtpUser", "Benutzer (leer = IMAP-Benutzer)", { defaultValue: c.smtpUser ?? "", autoComplete: "off" })}
        {field("smtpPassword", "Passwort (leer = wie IMAP)", { type: "password", autoComplete: "new-password" })}
      </fieldset>
      <label className="block">
        <span className={labelCls}>Signatur</span>
        <textarea name="signature" rows={4} defaultValue={c.signature ?? ""} className={inputCls} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Zuweisung neuer Gespräche</span>
          <select name="assignment" defaultValue={c.assignment} className={inputCls}>
            {Object.entries(ASSIGNMENT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className={labelCls}>Rundlauf auf (leer = alle Mitglieder)</legend>
          <div className="max-h-32 space-y-1 overflow-y-auto text-sm">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2"><input type="checkbox" name="assigneeIds" value={u.id} defaultChecked={c.assigneeIds.includes(u.id)} /> {u.name}</label>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="text-sm text-ink-400 dark:text-ink-200">Passwörter werden verschlüsselt gespeichert und nie wieder angezeigt. Bei Google/Microsoft ein App-Passwort verwenden.</p>
      <div className="flex items-center gap-3">
        <Submit>{initial ? "Speichern" : "Postfach verbinden"}</Submit>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function TestButton({ action }: { action: (p: SettingsState) => Promise<SettingsState> }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="space-y-1">
      <Submit ghost>Verbindung testen</Submit>
      <Msg s={state} />
    </form>
  );
}

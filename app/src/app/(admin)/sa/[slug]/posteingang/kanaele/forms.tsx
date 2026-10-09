"use client";

import { StateForm, Submit, type FormState } from "@/components/users/StateForm";
import { inputCls, labelCls } from "@/components/ui";

type Act = (prev: FormState, fd: FormData) => Promise<FormState>;

export function WhatsAppForm({ action, initial }: { action: Act; initial?: { name: string; number: string; phoneNumberId: string; wabaId: string } }) {
  return (
    <StateForm action={action}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Name des Kanals</span>
          <input name="name" required defaultValue={initial?.name ?? "WhatsApp"} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>WhatsApp-Rufnummer (mit +49 …)</span>
          <input name="number" required defaultValue={initial?.number} placeholder="+49 170 1234567" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Phone Number ID</span>
          <input name="phoneNumberId" required inputMode="numeric" defaultValue={initial?.phoneNumberId} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>WhatsApp-Business-Konto-ID (WABA)</span>
          <input name="wabaId" required inputMode="numeric" defaultValue={initial?.wabaId} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Zugriffstoken (System-User, dauerhaft)</span>
          <input name="accessToken" type="password" autoComplete="off" placeholder={initial ? "unverändert lassen" : ""} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>App-Secret (für die Webhook-Signatur)</span>
          <input name="appSecret" type="password" autoComplete="off" placeholder={initial ? "unverändert lassen" : ""} className={inputCls} />
        </label>
      </div>
      <p className="text-sm text-ink-400 dark:text-ink-200">Geheimnisse werden verschlüsselt gespeichert und nie wieder angezeigt.</p>
      <Submit>{initial ? "Änderungen speichern" : "WhatsApp verbinden"}</Submit>
    </StateForm>
  );
}

export function SmsForm({ action, initial }: { action: Act; initial?: { name: string; number: string; senderId: string } }) {
  return (
    <StateForm action={action}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Name des Kanals</span>
          <input name="name" required defaultValue={initial?.name ?? "SMS"} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Eigene SMS-Nummer bei seven.io (für Antworten)</span>
          <input name="number" required defaultValue={initial?.number} placeholder="+49 157 …" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Absenderkennung (optional, max. 11 Zeichen)</span>
          <input name="senderId" maxLength={16} defaultValue={initial?.senderId} placeholder="z. B. OneLog" className={inputCls} />
          <span className="mt-1 block text-xs text-ink-400 dark:text-ink-200">Mit Text-Absender können Empfänger nicht antworten. Für Gespräche leer lassen.</span>
        </label>
        <label className="block">
          <span className={labelCls}>API-Schlüssel</span>
          <input name="apiKey" type="password" autoComplete="off" placeholder={initial ? "unverändert lassen" : ""} className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Signierschlüssel (Webhooks)</span>
          <input name="signingSecret" type="password" autoComplete="off" placeholder={initial ? "unverändert lassen" : ""} className={inputCls} />
        </label>
      </div>
      <Submit>{initial ? "Änderungen speichern" : "SMS verbinden"}</Submit>
    </StateForm>
  );
}

export function TestForm({ action }: { action: Act }) {
  return (
    <StateForm action={action} inline>
      <Submit variant="ghost">Verbindung testen</Submit>
    </StateForm>
  );
}

export function ToggleForm({ action, active }: { action: Act; active: boolean }) {
  return (
    <StateForm action={action} inline>
      <Submit variant={active ? "danger" : "ghost"} confirm={active ? "Kanal deaktivieren? Eingehende Nachrichten werden dann abgelehnt." : undefined}>
        {active ? "Deaktivieren" : "Aktivieren"}
      </Submit>
    </StateForm>
  );
}

export function SendTestForm({ action }: { action: Act }) {
  return (
    <StateForm action={action}>
      <div className="grid gap-2 md:grid-cols-[14rem_1fr_auto]">
        <input name="to" required placeholder="+49 170 …" aria-label="Empfänger-Rufnummer" className={inputCls} />
        <input name="text" maxLength={500} placeholder="Testnachricht aus dem CRM." aria-label="Text" className={inputCls} />
        <Submit variant="ghost">Test senden</Submit>
      </div>
    </StateForm>
  );
}

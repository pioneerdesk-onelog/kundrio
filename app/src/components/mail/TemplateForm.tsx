import type { EmailTemplate } from "@prisma/client";
import { btnCls, inputCls, labelCls } from "@/components/ui";

// Formular für E-Mail-Vorlagen (Server-Action als `action`).
export function TemplateForm({ action, t }: { action: (fd: FormData) => Promise<void>; t?: EmailTemplate }) {
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label><span className={labelCls}>Name (intern)</span><input name="name" required maxLength={120} defaultValue={t?.name} className={inputCls} /></label>
        <label><span className={labelCls}>Betreff</span><input name="subject" required maxLength={300} defaultValue={t?.subject} className={inputCls} placeholder="Willkommen, {{ params.name }}" /></label>
        <label><span className={labelCls}>Absendername (optional)</span><input name="senderName" maxLength={120} defaultValue={t?.senderName ?? ""} className={inputCls} /></label>
        <label><span className={labelCls}>Absenderadresse (optional)</span><input name="senderEmail" type="email" defaultValue={t?.senderEmail ?? ""} className={inputCls} placeholder="leer = Absender des Sub-Accounts" /></label>
        <label className="md:col-span-2"><span className={labelCls}>Antwort an (optional)</span><input name="replyTo" type="email" defaultValue={t?.replyTo ?? ""} className={inputCls} /></label>
      </div>
      <label>
        <span className={labelCls}>HTML</span>
        <textarea name="html" required rows={14} defaultValue={t?.html} className={`${inputCls} font-mono text-sm`} placeholder="<p>Hallo {{ params.name | default: &quot;zusammen&quot; }},</p>" />
      </label>
      <label>
        <span className={labelCls}>Text-Fassung (optional – sonst automatisch aus HTML)</span>
        <textarea name="text" rows={5} defaultValue={t?.text ?? ""} className={`${inputCls} font-mono text-sm`} />
      </label>
      <details className="text-sm text-ink-600 dark:text-ink-200">
        <summary className="cursor-pointer font-medium">Platzhalter-Hilfe</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><code>{"{{ params.name }}"}</code> – Wert aus <code>params</code> des API-Aufrufs (auch verschachtelt: <code>{"{{ params.order.id }}"}</code>)</li>
          <li><code>{"{{ contact.FIRSTNAME }}"}</code>, <code>LASTNAME</code>, <code>EMAIL</code>, <code>COMPANY</code> und eigene Felder – aus dem CRM-Kontakt des ersten Empfängers</li>
          <li><code>{'{{ params.name | default: "Gast" }}'}</code> – Ersatzwert, wenn leer</li>
          <li>Werte werden im HTML automatisch maskiert. Bedingungen und Schleifen gibt es bewusst nicht.</li>
        </ul>
      </details>
      <div><button className={btnCls}>Speichern</button></div>
    </form>
  );
}

import { Card } from "@/components/ui";
import { CopyButton } from "./CopyButton";

// Umstiegs-Anleitung: Produkte wechseln von Brevo auf die CRM-Schnittstelle (nur Basis-URL + Schlüssel).

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-ink-900 p-3 text-[13px] leading-relaxed text-ink-50"><code>{children}</code></pre>
      <div className="absolute right-2 top-2"><CopyButton text={children} /></div>
    </div>
  );
}

export function MigrationGuide({ base, eventsUrl, eventsConfigured }: { base: string; eventsUrl: string; eventsConfigured: boolean }) {
  return (
    <div className="space-y-6">
      <Card title="So funktioniert der Umstieg">
        <ol className="list-decimal space-y-2 pl-5 text-[15px]">
          <li>Unter „Schlüssel“ einen API-Schlüssel mit <code>mail:send</code> anlegen (je Produkt einen eigenen).</li>
          <li>Im Produkt die Brevo-Adresse <code>https://api.brevo.com/v3</code> durch <code>{base}</code> ersetzen und den neuen Schlüssel eintragen. Header, Nutzlast und Antwort (<code>201 {"{ messageId }"}</code>) bleiben gleich.</li>
          <li>Absender muss zur Domain dieses Sub-Accounts oder einer erlaubten Domain gehören (Einstellungen).</li>
          <li>Testmail auslösen und im „Versandprotokoll“ prüfen.</li>
        </ol>
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">
          Nicht unterstützt: <code>messageVersions</code>, <code>sender.id</code>, Anhänge per URL (bitte base64 in <code>attachment.content</code>). Platzhalter: <code>{"{{ params.x }}"}</code>, <code>{"{{ contact.FIRSTNAME }}"}</code>.
        </p>
      </Card>

      <Card title="Kompetenzanker (TypeScript) – src/lib/email/brevo.ts">
        <Code>{`- const res = await fetch("https://api.brevo.com/v3/smtp/email", {
+ const base = process.env.MAIL_API_BASE ?? "https://api.brevo.com/v3";
+ const res = await fetch(\`\${base}/smtp/email\`, {
    method: "POST",
    headers: { "api-key": e.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },

# .env
MAIL_API_BASE=${base}
BREVO_API_KEY=pdk_…   # neuer Schlüssel aus dem CRM`}</Code>
      </Card>

      <Card title="Infercom-Router (Python) – src/infercom_router/mail.py">
        <Code>{`- BREVO_URL = "https://api.brevo.com/v3/smtp/email"
+ BREVO_URL = os.environ.get("MAIL_API_BASE", "https://api.brevo.com/v3").rstrip("/") + "/smtp/email"

# Umgebung
MAIL_API_BASE=${base}
BREVO_API_KEY=pdk_…`}</Code>
      </Card>

      <Card title="Verifact-Wächter (Go) – internal/waechter/mail.go">
        <Code>{`// Kein Code-Umbau nötig: Mailziel.URL überschreibt BrevoURL.
Mailziel{
    Schluessel: "pdk_…",
    URL:        "${base}/smtp/email",
    …
}
// bzw. die Konfigurationsquelle von Mailziel.URL entsprechend setzen`}</Code>
      </Card>

      <Card title="Beliebiges Produkt (curl)">
        <Code>{`curl -X POST ${base}/smtp/email \\
  -H "api-key: pdk_…" -H "content-type: application/json" \\
  -d '{"sender":{"email":"info@<ihre-domain>","name":"Absender"},
       "to":[{"email":"empfaenger@example.com"}],
       "subject":"Hallo {{ params.name }}",
       "htmlContent":"<p>Hallo {{ params.name }}</p>",
       "params":{"name":"Erika"}}'`}</Code>
      </Card>

      <Card title="Übergangsbetrieb: Brevo nur noch als Versandleitung">
        <p className="mb-3 text-[15px]">
          Kontakte, Vorlagen, Einwilligungen und Protokolle liegen im CRM. Brevo transportiert nur noch die Mails (SMTP-Relay), bis ein EU-Relay oder eigener Mailserver bereitsteht.
        </p>
        <Code>{`# app/.env des CRM
MAIL_MODE=live
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<Brevo-SMTP-Login>
SMTP_PASS=<Brevo-SMTP-Schlüssel (nicht der API-Schlüssel)>
MAIL_EVENTS_SECRET=<lange Zufallszeichenkette>`}</Code>
        <p className="mt-3 text-[15px]">
          In Brevo unter Transaktional → Webhooks diesen Ereignis-Eingang eintragen (Bounces, Spam, Zustellung):{" "}
          {eventsConfigured ? <span className="text-emerald-700 dark:text-emerald-300">MAIL_EVENTS_SECRET ist gesetzt.</span> : <span className="text-amber-700 dark:text-amber-300">MAIL_EVENTS_SECRET ist noch nicht gesetzt.</span>}
        </p>
        <Code>{`${eventsUrl}?secret=<MAIL_EVENTS_SECRET>`}</Code>
        <p className="mt-3 text-sm text-ink-600 dark:text-ink-200">Harte Bounces und Spam-Beschwerden landen automatisch auf der Sperrliste dieses Sub-Accounts. Voraussetzung: das CRM ist für Brevo öffentlich per HTTPS erreichbar.</p>
      </Card>
    </div>
  );
}

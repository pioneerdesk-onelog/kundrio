import { can, hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { CONNECTORS, liveAllowed } from "@/lib/payments/registry";
import { listProviders } from "@/lib/payments/service";
import { Badge, Card, PageHeader, inputCls, labelCls } from "@/components/ui";
import { CopyButton } from "@/components/mail/CopyButton";
import { PayForm } from "@/components/payments/forms";
import { registerWebhookAction, saveProviderAction, testProviderAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  ok: { label: "verbunden", tone: "ok" },
  unchecked: { label: "nicht geprüft", tone: "warn" },
  error: { label: "Fehler", tone: "bad" },
};

const NOTES: Record<string, string> = {
  mollie: "Niederländischer Zahlungsdienst (EU-Lizenz). Wero, Karte, PayPal, Klarna, Apple Pay, Überweisung u. v. m. über eine Schnittstelle. Webhook wird je Zahlung automatisch mitgegeben.",
  revolut: "Revolut Merchant (Bank in Litauen). Karte, Revolut Pay, Apple/Google Pay, Pay by Bank. Webhook per Knopfdruck einrichten – das Signatur-Geheimnis wird automatisch übernommen.",
  unzer: "Deutscher Zahlungsdienst (BaFin). Gehostete Bezahlseite inkl. Wero. Webhook per Knopfdruck einrichten. Unzer-Benachrichtigungen sind unsigniert – der Status wird deshalb immer mit Ihrem Schlüssel abgefragt.",
};

export default async function ProvidersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  const manage = can(access, "invoices", "edit") && hasSpecial(access, "manage_keys") && hasSpecial(access, "manage_settings");
  const rows = await listProviders(ws.id);
  const live = liveAllowed();

  return (
    <div className="space-y-6">
      <PageHeader title="Zahlungsanbieter verbinden" description="Ein Anbieter genügt. Der Standard-Anbieter erzeugt die Bezahllinks auf Rechnungen. Zugangsdaten werden verschlüsselt gespeichert und nie angezeigt." />
      {!live && (
        <p role="note" className="rounded-md bg-amber-50 p-3 text-[15px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          Testbetrieb: Auf diesem Server sind nur Test-Zugänge (Sandbox) erlaubt. Echte Zahlungen erst nach Freischaltung durch den Betreiber (PAYMENTS_MODE=live).
        </p>
      )}
      <details className="rounded-md border border-ink-100 p-3 text-[15px] dark:border-white/10" open={!manage}>
        <summary className="cursor-pointer font-medium">Wer darf Zahlungsanbieter verbinden – und warum?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-600 dark:text-ink-200">
          <li><strong>Rechnungen bearbeiten</strong> – der Anbieter erzeugt Bezahllinks und setzt Rechnungen auf „bezahlt“.</li>
          <li><strong>API-, MCP- und Webhook-Zugänge verwalten</strong> – Sie hinterlegen einen geheimen API-Schlüssel, mit dem Geld bewegt (z. B. erstattet) werden kann, und richten einen Webhook ein. Das ist so heikel wie ein API-Schlüssel für das CRM selbst.</li>
          <li><strong>Einstellungen &amp; Branding</strong> – Standard-Anbieter und Zahlarten gelten für alle Rechnungen und das Kundenportal des Sub-Accounts.</li>
        </ul>
        <p className="mt-2 text-sm text-ink-400 dark:text-ink-200">
          {manage ? "Sie haben alle drei Rechte." : "Ihnen fehlt mindestens eines dieser Rechte. Standardmäßig hat sie nur die Rolle „Admin“ – bitten Sie einen Admin, den Anbieter zu verbinden."} Bezahllinks verschicken und Zahlungen ansehen geht auch ohne diese Rechte.
        </p>
      </details>

      {Object.values(CONNECTORS).map((c) => {
        const row = rows.find((r) => r.provider === c.key);
        const st = row ? (STATUS[row.status] ?? { label: row.status, tone: "neutral" as const }) : null;
        return (
          <Card
            key={c.key}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {c.label}
                {st && <Badge tone={st.tone}>{st.label}</Badge>}
                {row && <Badge tone={row.mode === "live" ? "accent" : "warn"}>{row.mode === "live" ? "Live" : "Test"}</Badge>}
                {row?.isDefault && <Badge tone="accent">Standard</Badge>}
                {row && !row.active && <Badge>inaktiv</Badge>}
              </span>
            }
          >
            <p className="mb-3 text-[15px] text-ink-600 dark:text-ink-200">{NOTES[c.key]} <span className="text-sm">Sitz: {c.company}, {c.country}.</span></p>
            {row?.lastError && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">Letzter Fehler: {row.lastError}</p>}
            {row && (
              <div className="mb-4 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-600 dark:text-ink-200">Webhook-Adresse:</span>
                  <code className="break-all">{row.webhookUrl}</code>
                  <CopyButton text={row.webhookUrl} label="Kopieren" />
                </div>
                {!/^https:\/\//.test(row.webhookUrl) && <p className="text-amber-700 dark:text-amber-300">Hinweis: Diese Adresse ist lokal und für den Anbieter nicht erreichbar. Zahlungen werden dann alle 15 Minuten und bei Rückkehr des Kunden abgefragt.</p>}
              </div>
            )}

            {manage && (
              <div className="space-y-4">
                <PayForm action={saveProviderAction.bind(null, slug, c.key)} submit={row ? "Speichern" : "Verbinden"} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {c.fields.map((f) => (
                      <div key={f.name}>
                        <label htmlFor={`${c.key}-${f.name}`} className={labelCls}>{f.label}{f.required && " *"}</label>
                        <input
                          id={`${c.key}-${f.name}`}
                          name={`cred_${f.name}`}
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          placeholder={row?.masked[f.name] ? `gespeichert: ${row.masked[f.name]} (leer lassen = behalten)` : f.placeholder}
                          className={inputCls}
                        />
                        {f.help && <p className="mt-1 text-sm text-ink-400">{f.help}</p>}
                      </div>
                    ))}
                    <div>
                      <label htmlFor={`${c.key}-mode`} className={labelCls}>Modus</label>
                      <select id={`${c.key}-mode`} name="mode" defaultValue={row?.mode ?? "test"} className={inputCls}>
                        <option value="test">Test (Sandbox)</option>
                        <option value="live" disabled={!live}>Live{live ? "" : " (nicht freigeschaltet)"}</option>
                      </select>
                    </div>
                  </div>
                  <fieldset>
                    <legend className={labelCls}>Zahlarten auf der Bezahlseite (leer = alle beim Anbieter aktivierten)</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {c.knownMethods.map((m) => (
                        <label key={m.id} className="flex items-center gap-1.5 text-[15px]">
                          <input type="checkbox" name="methods" value={m.id} defaultChecked={row?.methods.includes(m.id)} /> {m.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap gap-4 text-[15px]">
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={row?.active ?? true} /> aktiv</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="isDefault" defaultChecked={row?.isDefault ?? rows.length === 0} /> Standard für Bezahllinks</label>
                  </div>
                </PayForm>
                {row && (
                  <div className="flex flex-wrap gap-3">
                    <PayForm action={testProviderAction.bind(null, slug, c.key)} submit="Verbindung testen" tone="ghost" className="space-y-1" />
                    {c.webhookSetup === "api" && <PayForm action={registerWebhookAction.bind(null, slug, c.key)} submit="Webhook beim Anbieter einrichten" tone="ghost" className="space-y-1" confirm="Webhook-Adresse jetzt beim Anbieter eintragen?" />}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

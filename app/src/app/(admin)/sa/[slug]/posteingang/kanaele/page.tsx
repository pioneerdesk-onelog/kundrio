import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hasSpecial } from "@/lib/permissions";
import { pageAccess } from "@/lib/permissions/guard";
import { openCredentials } from "@/lib/inbox/credentials";
import { listWhatsAppTemplates } from "@/lib/messaging/whatsapp-cloud";
import { messagingMode, parseNumberAllowlist } from "@/lib/messaging/mode";
import { Badge, Card, PageHeader } from "@/components/ui";
import { NoAccess } from "@/components/users/NoAccess";
import { saveSms, saveWhatsApp, sendTest, setChannelActive, testChannel } from "./actions";
import { SendTestForm, SmsForm, TestForm, ToggleForm, WhatsAppForm } from "./forms";

export const dynamic = "force-dynamic";

const STATUS_TONE = { ok: "ok", error: "bad", reconnect: "warn" } as const;

export default async function MessagingChannelsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws, access } = await pageAccess(slug);
  if (!hasSpecial(access, "manage_keys")) return <NoAccess />;

  const inboxes = await db.inbox.findMany({ where: { workspaceId: ws.id, kind: { in: ["whatsapp", "sms"] } }, orderBy: { createdAt: "asc" } });
  const mode = messagingMode();
  const allow = parseNumberAllowlist(process.env.MESSAGING_LIVE_ALLOWLIST);
  const base = env.appUrl().replace(/\/+$/, "");

  const templates = new Map<string, { name: string; status: string; category: string; language: string }[] | string>();
  for (const i of inboxes.filter((x) => x.kind === "whatsapp" && x.active)) {
    try {
      templates.set(i.id, await listWhatsAppTemplates(i, openCredentials(i)));
    } catch (e) {
      templates.set(i.id, e instanceof Error ? e.message : "Vorlagen konnten nicht geladen werden");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp & SMS" description="Kanäle für den Posteingang einrichten. Nachrichten erscheinen danach im gemeinsamen Posteingang." />

      <Card title="Versandmodus">
        <p>
          {mode === "capture" ? (
            <Badge tone="warn">Testmodus</Badge>
          ) : (
            <Badge tone="ok">Live</Badge>
          )}{" "}
          {mode === "capture"
            ? "MESSAGING_MODE=capture: Es wird nichts an WhatsApp/SMS-Anbieter gesendet; Nachrichten werden nur protokolliert."
            : allow
              ? `Live – aber nur an ${allow.length} freigegebene Nummer(n) (MESSAGING_LIVE_ALLOWLIST); alle anderen werden protokolliert, nicht gesendet.`
              : "Live – Nachrichten gehen an alle Empfänger."}
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-200">
          <li>Werbung per SMS/WhatsApp nur mit vorheriger ausdrücklicher Einwilligung (§ 7 Abs. 2 Nr. 2 UWG) – am Kontakt mit Nachweis erfassen.</li>
          <li>Antwortet jemand „STOP“ oder „ABMELDEN“, wird der Kontakt automatisch für diesen Kanal abgemeldet und erhält eine Bestätigung.</li>
          <li>WhatsApp: Freitext nur bis 24 Stunden nach der letzten Nachricht des Kunden, danach nur freigegebene Vorlagen.</li>
        </ul>
      </Card>

      {inboxes.map((i) => {
        const cfg = (i.config ?? {}) as { phoneNumberId?: string; wabaId?: string; senderId?: string };
        const hook = `${base}/api/messaging/${i.provider}/${i.id}`;
        const creds = openCredentials(i);
        const tpl = templates.get(i.id);
        return (
          <Card
            key={i.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {i.kind === "whatsapp" ? "WhatsApp" : "SMS"}: {i.name} <span className="font-normal text-ink-400">{i.address}</span>
                <Badge tone={i.active ? STATUS_TONE[i.status as keyof typeof STATUS_TONE] ?? "neutral" : "neutral"}>{i.active ? (i.status === "ok" ? "aktiv" : i.status) : "deaktiviert"}</Badge>
              </span>
            }
          >
            {i.lastError && <p className="mb-3 text-sm text-red-700 dark:text-red-300">Letzter Fehler: {i.lastError}</p>}
            <dl className="mb-4 grid gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="text-ink-400">Webhook-URL (beim Anbieter eintragen)</dt>
                <dd className="break-all font-mono">{hook}</dd>
              </div>
              {i.kind === "whatsapp" && (
                <div>
                  <dt className="text-ink-400">Verify-Token (bei Meta eintragen)</dt>
                  <dd className="break-all font-mono">{creds.verifyToken ?? "–"}</dd>
                </div>
              )}
              <div>
                <dt className="text-ink-400">Letzter Eingang</dt>
                <dd>{i.lastSyncAt ? i.lastSyncAt.toLocaleString("de-DE") : "noch keiner"}</dd>
              </div>
            </dl>
            <div className="mb-4 flex flex-wrap gap-2">
              <TestForm action={testChannel.bind(null, slug, i.id)} />
              <ToggleForm action={setChannelActive.bind(null, slug, i.id, !i.active)} active={i.active} />
            </div>
            {i.kind === "whatsapp" && (
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-semibold">Freigegebene Vorlagen (für Nachrichten außerhalb des 24-h-Fensters)</h3>
                {typeof tpl === "string" ? (
                  <p className="text-sm text-ink-400">{tpl}</p>
                ) : tpl && tpl.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-left text-ink-400">
                      <tr><th className="py-1">Name</th><th>Sprache</th><th>Kategorie</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {tpl.map((t) => (
                        <tr key={`${t.name}-${t.language}`} className="border-t border-ink-100 dark:border-white/10">
                          <td className="py-1 font-mono">{t.name}</td><td>{t.language}</td><td>{t.category}</td>
                          <td><Badge tone={t.status === "APPROVED" ? "ok" : t.status === "REJECTED" ? "bad" : "warn"}>{t.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-ink-400">Keine Vorlagen gefunden. Vorlagen werden im WhatsApp Manager angelegt und von Meta geprüft.</p>
                )}
              </div>
            )}
            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-medium">Testnachricht senden</summary>
              <div className="mt-2">
                <SendTestForm action={sendTest.bind(null, slug, i.id)} />
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium">Einstellungen ändern</summary>
              <div className="mt-3">
                {i.kind === "whatsapp" ? (
                  <WhatsAppForm action={saveWhatsApp.bind(null, slug)} initial={{ name: i.name, number: i.address, phoneNumberId: cfg.phoneNumberId ?? "", wabaId: cfg.wabaId ?? "" }} />
                ) : (
                  <SmsForm action={saveSms.bind(null, slug)} initial={{ name: i.name, number: i.address, senderId: cfg.senderId ?? "" }} />
                )}
              </div>
            </details>
          </Card>
        );
      })}

      <Card title="WhatsApp verbinden (Meta Cloud API)">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-200">
          <li>Im Meta Business Manager ein Business-Konto verifizieren und unter developers.facebook.com eine App vom Typ „Business“ mit dem Produkt „WhatsApp“ anlegen.</li>
          <li>Telefonnummer im WhatsApp Manager hinzufügen und verifizieren (sie darf nicht gleichzeitig in der WhatsApp-App genutzt werden).</li>
          <li>Empfehlung: unter „Local storage“ für die Nummer den Speicherort <strong>EU (Deutschland)</strong> wählen.</li>
          <li>System-Benutzer anlegen, dauerhaftes Token mit den Rechten <code>whatsapp_business_messaging</code> und <code>whatsapp_business_management</code> erzeugen.</li>
          <li>Phone Number ID, WABA-ID, Token und App-Secret (App-Einstellungen → Allgemein) unten eintragen.</li>
          <li>Nach dem Speichern die angezeigte Webhook-URL und das Verify-Token in der App unter WhatsApp → Konfiguration eintragen und das Feld <code>messages</code> abonnieren.</li>
        </ol>
        <WhatsAppForm action={saveWhatsApp.bind(null, slug)} />
      </Card>

      <Card title="SMS verbinden (seven.io, Deutschland)">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-200">
          <li>Konto bei seven.io anlegen, für Antworten eine eigene Nummer (Inbound) buchen.</li>
          <li>Unter Entwickler einen API-Schlüssel und den Signierschlüssel für Webhooks erzeugen.</li>
          <li>Nach dem Speichern die angezeigte Webhook-URL für die Ereignisse „Eingehende SMS“ (sms_mo) und „Zustellberichte“ (dlr) eintragen.</li>
        </ol>
        <SmsForm action={saveSms.bind(null, slug)} />
      </Card>
    </div>
  );
}

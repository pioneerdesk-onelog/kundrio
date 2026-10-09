import { db } from "@/lib/db";
import { consentState } from "@/lib/messaging/consent";
import { toE164 } from "@/lib/messaging/phone";
import { Badge, Card, inputCls } from "@/components/ui";
import { StateForm, Submit } from "@/components/users/StateForm";
import { updateChannelConsent } from "@/app/(admin)/sa/[slug]/posteingang/kanaele/consent-actions";

// Einwilligungen für SMS/WhatsApp am Kontakt (Werbung nur mit Einwilligung, § 7 Abs. 2 Nr. 2 UWG).
// Einbau: <ChannelConsent slug={slug} workspaceId={ws.id} contactId={c.id} canEdit={mayEdit} />

const fmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString("de-DE") : null);

export async function ChannelConsent({ slug, workspaceId, contactId, canEdit }: { slug: string; workspaceId: string; contactId: string; canEdit: boolean }) {
  const c = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { phone: true, smsConsentAt: true, whatsappConsentAt: true, whatsappOptOutAt: true, attributes: true },
  });
  if (!c) return null;
  const state = consentState(c);
  const number = toE164(c.phone);
  const rows = [
    { kind: "whatsapp" as const, label: "WhatsApp", consent: state.whatsappConsentAt, optOut: state.whatsappOptOutAt },
    { kind: "sms" as const, label: "SMS", consent: state.smsConsentAt, optOut: state.smsOptOutAt },
  ];
  return (
    <Card title="WhatsApp & SMS">
      {!number && <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">Keine gültige Mobilnummer hinterlegt – Nachrichten sind erst mit Nummer möglich.</p>}
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.kind}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.label}</span>
              {r.optOut ? (
                <Badge tone="bad">abgemeldet seit {fmt(r.optOut)}</Badge>
              ) : r.consent ? (
                <Badge tone="ok">Einwilligung für Werbung seit {fmt(r.consent)}</Badge>
              ) : (
                <Badge tone="neutral">nur Service-Nachrichten (keine Werbe-Einwilligung)</Badge>
              )}
            </div>
            {canEdit && (
              <div className="mt-2">
                {r.optOut ? (
                  <StateForm action={updateChannelConsent.bind(null, slug, contactId, r.kind, "optin")} inline>
                    <Submit variant="ghost" confirm="Abmeldung nur aufheben, wenn der Kontakt dem ausdrücklich zugestimmt hat (z. B. per START).">Abmeldung aufheben</Submit>
                  </StateForm>
                ) : r.consent ? (
                  <StateForm action={updateChannelConsent.bind(null, slug, contactId, r.kind, "revoke")} inline>
                    <Submit variant="ghost">Einwilligung widerrufen</Submit>
                  </StateForm>
                ) : (
                  <StateForm action={updateChannelConsent.bind(null, slug, contactId, r.kind, "grant")} inline>
                    <input name="source" required minLength={5} maxLength={300} placeholder="Nachweis: wie/wo erteilt?" aria-label={`Nachweis ${r.label}-Einwilligung`} className={`${inputCls} max-w-xs`} />
                    <Submit variant="ghost">Einwilligung erfassen</Submit>
                  </StateForm>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

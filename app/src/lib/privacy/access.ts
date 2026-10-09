import "server-only";
import { db } from "../db";
import { addrRegex } from "./match";

// Auskunft nach Art. 15 DSGVO bzw. Datenübertragbarkeit nach Art. 20 für EINEN Kontakt – maschinenlesbar (JSON).
// Umfasst dieselben Bereiche, die eraseContact() löscht (src/lib/privacy/erase.ts); bei neuen Tabellen beide anpassen.
// Nicht enthalten: interne Geheimnisse (verschlüsselte IBAN, Token-Hashes), Inhalte von Dateianhängen (nur Metadaten).


export async function buildContactAccessReport(workspaceId: string, contactId: string) {
  const ws = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { name: true, legalName: true, legalAddress: true, legalEmail: true, legalPhone: true },
  });
  const c = await db.contact.findFirst({
    where: { id: contactId, workspaceId },
    include: { owner: { select: { name: true } }, companyRecord: { select: { name: true, domain: true } } },
  });
  if (!c) return null;
  const email = c.email?.toLowerCase() ?? null;
  const addrs = [email, c.phone].filter((x): x is string => !!x);
  const re = addrs.map(addrRegex);

  const [
    activities, deals, tasks, tickets, events, formSubmissions, emails, campaigns, lists, conversations, invoices, subscriptions,
    mandates, mentions, suggestions, analytics, processRuns, automationRuns, suppression, crmEvents,
  ] = await Promise.all([
    db.activity.findMany({ where: { workspaceId, contactId }, orderBy: { createdAt: "asc" }, select: { type: true, body: true, createdAt: true } }),
    db.deal.findMany({ where: { workspaceId, contactId }, select: { title: true, valueCents: true, currency: true, closedAt: true, createdAt: true, stage: { select: { name: true } } } }),
    db.task.findMany({ where: { workspaceId, contactId }, select: { title: true, dueAt: true, doneAt: true, createdAt: true } }),
    db.ticket.findMany({ where: { workspaceId, contactId }, select: { numericId: true, subject: true, description: true, priority: true, source: true, createdAt: true, closedAt: true } }),
    db.event.findMany({
      where: { workspaceId, OR: [{ contactId }, ...(email ? [{ attendees: { array_contains: [{ email }] } }] : [])] },
      select: { title: true, startsAt: true, endsAt: true, location: true, description: true, status: true, source: true, attendees: true },
    }),
    db.$queryRaw<{ form: string; data: unknown; createdAt: Date }[]>`
      SELECT f.name AS form, s.data, s."createdAt" FROM "FormSubmission" s JOIN "Form" f ON f.id = s."formId"
      WHERE f."workspaceId" = ${workspaceId} AND (s."contactId" = ${contactId} OR (${email}::text IS NOT NULL AND s.data::text ILIKE '%' || ${email ?? ""} || '%'))
      ORDER BY s."createdAt"`,
    db.$queryRaw<{ id: string; direction: string; kind: string; fromAddr: string; toAddr: string; subject: string; bodyText: string; status: string; createdAt: Date; sentAt: Date | null }[]>`
      SELECT id, direction::text, kind, "fromAddr", "toAddr", subject, "bodyText", status, "createdAt", "sentAt" FROM "EmailMessage"
      WHERE "workspaceId" = ${workspaceId} AND ("contactId" = ${contactId}
        OR (${re.length > 0} AND ("toAddr" ~* ANY(${re}::text[]) OR "fromAddr" ~* ANY(${re}::text[]))))
      ORDER BY "createdAt"`,
    db.campaignRecipient.findMany({ where: { contactId }, select: { status: true, sentAt: true, campaign: { select: { name: true, subject: true } } } }),
    db.contactListMember.findMany({ where: { contactId }, select: { addedAt: true, list: { select: { name: true } } } }),
    db.conversation.findMany({
      where: { workspaceId, OR: [{ contactId }, ...(addrs.length ? [{ threadKey: { in: addrs } }] : [])] },
      select: {
        subject: true, status: true, createdAt: true, inbox: { select: { name: true, kind: true } },
        messages: { orderBy: { createdAt: "asc" }, select: { direction: true, channel: true, fromAddr: true, toAddrs: true, subject: true, bodyText: true, attachments: true, createdAt: true } },
      },
    }),
    db.invoice.findMany({ where: { workspaceId, contactId }, select: { kind: true, number: true, status: true, issueDate: true, grossCents: true, currency: true, buyerName: true, buyerAddress: true, buyerEmail: true } }),
    db.subscription.findMany({ where: { workspaceId, contactId }, select: { status: true, items: true, interval: true, startDate: true, endDate: true, cancelledAt: true, paymentMethod: true } }),
    db.sepaMandate.findMany({ where: { workspaceId, contactId }, select: { mandateRef: true, accountHolder: true, ibanLast4: true, bic: true, scheme: true, signedAt: true, status: true, revokedAt: true, lastUsedAt: true } }),
    db.mention.findMany({ where: { workspaceId, contactId }, select: { url: true, title: true, sourceHost: true, publishedAt: true, snippet: true, summary: true, sentiment: true } }),
    db.enrichmentSuggestion.findMany({ where: { workspaceId, objectType: "contact", objectId: contactId }, select: { field: true, value: true, sourceUrl: true, sourceKind: true, status: true, createdAt: true } }),
    db.analyticsEvent.findMany({ where: { workspaceId, contactId }, select: { ts: true, kind: true, name: true, path: true, host: true } }),
    db.processRun.findMany({ where: { workspaceId, objectType: "contact", objectId: contactId }, select: { status: true, startedAt: true, finishedAt: true, context: true, process: { select: { name: true } } } }),
    db.automationRun.findMany({ where: { contactId }, select: { status: true, createdAt: true, log: true, automation: { select: { name: true } } } }),
    email ? db.suppression.findUnique({ where: { workspaceId_email: { workspaceId, email } }, select: { reason: true, source: true, createdAt: true } }) : null,
    db.crmEvent.findMany({ where: { workspaceId, objectType: "contact", objectId: contactId }, orderBy: { id: "asc" }, select: { type: true, createdAt: true } }),
  ]);
  const emailEvents = emails.length
    ? await db.emailEvent.findMany({ where: { messageId: { in: emails.map((e) => e.id) } }, select: { messageId: true, event: true, at: true } })
    : [];

  return {
    hinweis:
      "Auskunft nach Art. 15 DSGVO über die zu Ihrer Person gespeicherten Daten. Maschinenlesbar (Art. 20 DSGVO). " +
      "Rechte: Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Widerspruch (Art. 21), Beschwerde bei einer Aufsichtsbehörde (Art. 77).",
    erstelltAm: new Date().toISOString(),
    verantwortlicher: { name: ws.legalName ?? ws.name, anschrift: ws.legalAddress, email: ws.legalEmail, telefon: ws.legalPhone },
    // Zwecke, Empfänger und Speicherdauer je Bereich: siehe Verzeichnis der Verarbeitungstätigkeiten (docs/Datenschutz-Durchsicht)
    stammdaten: {
      vorname: c.firstName, nachname: c.lastName, email: c.email, telefon: c.phone, firma: c.company, unternehmen: c.companyRecord,
      funktion: c.jobTitle, profilLinks: c.socialLinks, eigeneFelder: c.attributes, tags: c.tags, lifecyclePhase: c.lifecycleStage,
      notizen: c.notes, zustaendig: c.owner?.name ?? null, herkunft: c.source, externeReferenz: c.externalRef, angelegt: c.createdAt, geaendert: c.updatedAt,
      angereichertAm: c.enrichedAt,
    },
    einwilligungen: {
      emailEinwilligungAm: c.consentEmailAt, emailEinwilligungQuelle: c.consentSource, emailAbgemeldetAm: c.unsubscribedAt,
      smsEinwilligungAm: c.smsConsentAt, whatsappEinwilligungAm: c.whatsappConsentAt, whatsappAbgemeldetAm: c.whatsappOptOutAt,
      sperrliste: suppression,
    },
    // Automatisierte Bewertung (keine Entscheidung mit Rechtswirkung): Lead-Echtheit 0–100 mit Signalen
    leadEchtheit: { wert: c.trustScore, signale: c.trustSignals },
    zeitleiste: activities,
    deals, aufgaben: tasks, tickets, termine: events, formularEinsendungen: formSubmissions,
    emails: emails.map((e) => ({ ...e, ereignisse: emailEvents.filter((x) => x.messageId === e.id).map((x) => ({ ereignis: x.event, am: x.at })) })),
    kampagnen: campaigns, listen: lists, gespraeche: conversations, belege: invoices, abos: subscriptions, sepaMandate: mandates,
    erwaehnungen: mentions, anreicherungsVorschlaege: suggestions, analyticsZuordnung: analytics, prozessLaeufe: processRuns,
    automationsLaeufe: automationRuns, ereignisse: crmEvents,
  };
}

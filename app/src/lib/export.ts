import "server-only";
import { strToU8, zipSync, type Zippable } from "fflate";
import { db } from "./db";
import { storage } from "./storage";
import { toCsv } from "./a-csv";
import { NOT_EXPORTED } from "./export-coverage";

// Vollständiger Export eines Sub-Accounts (Exit-Fähigkeit, Art. 20 DSGVO).
// Enthält KEINE Passwort-Hashes, Sitzungen, Embeddings, Zugangsdaten (auch nicht verschlüsselt) oder Umgebungs-Secrets.
// Welche Tabelle in welcher Datei steckt, steht in export-coverage.ts (per Test gegen das Schema geprüft).

const json = (v: unknown) =>
  strToU8(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));

const README = (name: string, date: string) => `# Export: ${name}

Erstellt: ${date}
Format: UTF-8. JSON-Dateien enthalten je Tabelle ein Array von Datensätzen (Feldnamen wie im Datenmodell,
Datumswerte als ISO-8601, Beträge in Cent). CSV-Dateien mit Trennzeichen Komma und UTF-8-BOM für Excel.

Nicht enthalten (bewusst):
- Passwörter, Sitzungen und Zugangsschlüssel; verschlüsselte Zugangsdaten von Kanälen, Postfächern,
  Zahlungsanbietern, Bankkonten und DNS-Anbietern; Webhook-Geheimnisse; Schlüssel-Hashes
- vollständige IBAN der SEPA-Mandate (nur die letzten 4 Stellen; die verschlüsselte IBAN ist nur mit dem
  Server-Schlüssel lesbar)
${Object.entries(NOT_EXPORTED).map(([m, why]) => `- ${m}: ${why}`).join("\n")}

Dateien:
- workspace.json        Stammdaten und Branding des Sub-Accounts
- members.json          Benutzer (Name, E-Mail, Rolle) mit Zugriff
- contacts.json / .csv  Kontakte inkl. Einwilligungsnachweis (consentEmailAt, consentSource)
- activities.json       Zeitleiste
- pipelines.json        Pipelines mit Phasen
- deals.json / .csv     Deals
- tasks.json / .csv     Aufgaben
- events.json           Termine
- forms.json            Formulare inkl. Einsendungen
- campaigns.json        Kampagnen inkl. Empfängerstatus
- emails.json           E-Mail-Protokoll
- knowledge-sources.json  Wissensquellen (Originaltext bzw. URL)
- wiki.json             Wiki-Seiten inkl. Versionen
- channels.json         Kanäle inkl. Kennzahlen
- landing-pages.json    Landingpages (Puck-JSON)
- analytics-events.json Analytics-Ereignisse (ohne IP; Besucher-Hash tagesrotierend)
- automations.json      Automationen inkl. Läufe
- compliance.json       Pflichten
- invoices.json / .csv  Angebote und Rechnungen
- ai-usage.json         KI-Protokoll (Zweck, Modell, Dauer)
- files.json, files/    Hochgeladene Dateien (z. B. Brandbook) mit Metadaten
- roles.json, teams.json, invitations.json   Rollen, Teams, offene Einladungen
- companies.json, lifecycle-stages.json, properties.json, lists.json   Unternehmen, Phasen, eigene Felder, Listen
- tickets.json, meeting-types.json           Tickets, Terminvorlagen
- email-events.json, email-templates.json, suppressions.json, webhooks.json, api-keys.json
- inboxes.json, conversations.json           Posteingang mit Nachrichten (E-Mail, WhatsApp, SMS)
- processes.json, process-runs.json, crm-events.json, approvals.json, audit-log.json
- enrichment-suggestions.json, mentions.json, domains.json, usage.json
- products.json, subscriptions.json, sepa-mandates.json, direct-debits.json
- payment-providers.json, payments.json, bank-accounts.json, bank-transactions.json
`;

export async function buildWorkspaceExport(workspaceId: string): Promise<Zippable> {
  const where = { workspaceId };
  const [
    workspace, members, contacts, activities, pipelines, deals, tasks, events, forms, campaigns, emails,
    sources, wiki, channels, pages, analytics, automations, compliance, invoices, aiUsage,
  ] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    db.membership.findMany({ where, select: { role: true, roleRef: { select: { key: true, name: true } }, user: { select: { name: true, email: true } } } }),
    db.contact.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.activity.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.pipeline.findMany({ where, include: { stages: { orderBy: { position: "asc" } } } }),
    db.deal.findMany({ where, include: { stage: { select: { name: true } } } }),
    db.task.findMany({ where }),
    db.event.findMany({ where }),
    db.form.findMany({ where, include: { submissions: true } }),
    db.campaign.findMany({ where, include: { recipients: true } }),
    db.emailMessage.findMany({ where }),
    db.knowledgeSource.findMany({ where, include: { _count: { select: { chunks: true } } } }),
    db.wikiPage.findMany({ where, include: { revisions: { orderBy: { createdAt: "asc" } } } }),
    db.channelAccount.findMany({ where, omit: { credentials: true }, include: { metrics: { orderBy: { date: "asc" } }, posts: true } }),
    db.landingPage.findMany({ where }),
    db.analyticsEvent.findMany({ where, orderBy: { ts: "asc" } }),
    db.automation.findMany({ where, include: { runs: true } }),
    db.complianceItem.findMany({ where }),
    db.invoice.findMany({ where, orderBy: { number: "asc" } }),
    db.aiUsageLog.findMany({ where }),
  ]);

  // Weitere Tabellen (Welle 4–8): Objekte, Prozesse, Posteingang, Abos/SEPA, Zahlungen – ohne Zugangsdaten
  const [
    roles, teams, invitations, companies, lifecycle, properties, lists, tickets, meetingTypes, emailEvents, emailTemplates,
    suppressions, webhooks, apiKeys, inboxes, conversations, processes, processRuns, crmEvents, approvals, auditLog,
    suggestions, mentions, domains, usage, products, subscriptions, mandates, debits, paymentProviders, payments, bankAccounts,
    bankTransactions,
  ] = await Promise.all([
    db.role.findMany({ where }),
    db.team.findMany({ where, include: { members: { select: { user: { select: { name: true, email: true } } } } } }),
    db.invitation.findMany({ where, omit: { tokenHash: true } }),
    db.company.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.lifecycleStage.findMany({ where, orderBy: { position: "asc" } }),
    db.propertyDefinition.findMany({ where }),
    db.contactList.findMany({ where, include: { members: { select: { contactId: true, addedAt: true } } } }),
    db.ticket.findMany({ where, include: { stage: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.meetingType.findMany({ where }),
    db.emailEvent.findMany({ where, orderBy: { at: "asc" } }),
    db.emailTemplate.findMany({ where }),
    db.suppression.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.webhook.findMany({ where, omit: { secret: true } }),
    db.apiKey.findMany({ where, omit: { hash: true } }),
    db.inbox.findMany({ where, omit: { credentials: true } }),
    db.conversation.findMany({ where, include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }),
    db.process.findMany({ where, include: { versions: { orderBy: { version: "asc" } } } }),
    db.processRun.findMany({ where, include: { steps: { orderBy: { createdAt: "asc" } } }, orderBy: { startedAt: "asc" } }),
    db.crmEvent.findMany({ where, orderBy: { id: "asc" } }),
    db.approval.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.enrichmentSuggestion.findMany({ where }),
    db.mention.findMany({ where }),
    db.domain.findMany({ where, omit: { providerCredentials: true } }),
    db.usageSnapshot.findMany({ where, orderBy: { date: "asc" } }),
    db.product.findMany({ where }),
    db.subscription.findMany({ where }),
    db.sepaMandate.findMany({ where, omit: { ibanEncrypted: true } }),
    db.directDebitBatch.findMany({ where, include: { items: true }, orderBy: { createdAt: "asc" } }),
    db.paymentProvider.findMany({ where, omit: { credentials: true } }),
    db.payment.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.bankAccount.findMany({ where, omit: { credentials: true } }),
    db.bankTransaction.findMany({ where, orderBy: { bookingDate: "asc" } }),
  ]);

  // Hochgeladene Dateien (z. B. Brandbook) mit Inhalt – kein Lock-in
  const storedFiles = await db.storedFile.findMany({ where, orderBy: { createdAt: "asc" } });
  const fileEntries: Record<string, Uint8Array> = {};
  const fileMeta = [];
  for (const f of storedFiles) {
    const path = `files/${f.id}-${f.name.replace(/[^\w.\-äöüÄÖÜß ]/g, "_")}`;
    try {
      fileEntries[path] = new Uint8Array(await storage().get(f.storageKey));
      fileMeta.push({ ...f, exportPath: path });
    } catch {
      fileMeta.push({ ...f, exportPath: null, exportError: "Datei im Speicher nicht gefunden" });
    }
  }

  const bom = "﻿";
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
  return {
    "README.md": strToU8(README(workspace.name, new Date().toISOString())),
    "workspace.json": json(workspace),
    "members.json": json(members),
    "contacts.json": json(contacts),
    "contacts.csv": strToU8(
      bom +
        toCsv([
          ["id", "firstName", "lastName", "email", "phone", "company", "source", "tags", "consentEmailAt", "consentSource", "unsubscribedAt", "createdAt"],
          ...contacts.map((c) => [c.id, c.firstName, c.lastName, c.email, c.phone, c.company, c.source, c.tags.join(";"), iso(c.consentEmailAt), c.consentSource, iso(c.unsubscribedAt), iso(c.createdAt)]),
        ]),
    ),
    "activities.json": json(activities),
    "pipelines.json": json(pipelines),
    "deals.json": json(deals),
    "deals.csv": strToU8(
      bom + toCsv([["id", "title", "stage", "valueCents", "currency", "contactId", "closedAt", "createdAt"], ...deals.map((d) => [d.id, d.title, d.stage.name, d.valueCents, d.currency, d.contactId, iso(d.closedAt), iso(d.createdAt)])]),
    ),
    "tasks.json": json(tasks),
    "tasks.csv": strToU8(bom + toCsv([["id", "title", "dueAt", "doneAt", "contactId", "dealId"], ...tasks.map((t) => [t.id, t.title, iso(t.dueAt), iso(t.doneAt), t.contactId, t.dealId])])),
    "events.json": json(events),
    "forms.json": json(forms),
    "campaigns.json": json(campaigns),
    "emails.json": json(emails),
    "knowledge-sources.json": json(sources),
    "wiki.json": json(wiki),
    "channels.json": json(channels),
    "landing-pages.json": json(pages),
    "analytics-events.json": json(analytics),
    "automations.json": json(automations),
    "compliance.json": json(compliance),
    "invoices.json": json(invoices),
    "invoices.csv": strToU8(
      bom +
        toCsv([
          ["kind", "number", "status", "issueDate", "dueDate", "buyerName", "netCents", "vatCents", "grossCents", "currency"],
          ...invoices.map((i) => [i.kind, i.number, i.status, iso(i.issueDate).slice(0, 10), iso(i.dueDate).slice(0, 10), i.buyerName, i.netCents, i.vatCents, i.grossCents, i.currency]),
        ]),
    ),
    "ai-usage.json": json(aiUsage),
    "files.json": json(fileMeta),
    "roles.json": json(roles),
    "teams.json": json(teams),
    "invitations.json": json(invitations),
    "companies.json": json(companies),
    "lifecycle-stages.json": json(lifecycle),
    "properties.json": json(properties),
    "lists.json": json(lists),
    "tickets.json": json(tickets),
    "meeting-types.json": json(meetingTypes),
    "email-events.json": json(emailEvents),
    "email-templates.json": json(emailTemplates),
    "suppressions.json": json(suppressions),
    "webhooks.json": json(webhooks),
    "api-keys.json": json(apiKeys),
    "inboxes.json": json(inboxes),
    "conversations.json": json(conversations),
    "processes.json": json(processes),
    "process-runs.json": json(processRuns),
    "crm-events.json": json(crmEvents),
    "approvals.json": json(approvals),
    "audit-log.json": json(auditLog),
    "enrichment-suggestions.json": json(suggestions),
    "mentions.json": json(mentions),
    "domains.json": json(domains),
    "usage.json": json(usage),
    "products.json": json(products),
    "subscriptions.json": json(subscriptions),
    "sepa-mandates.json": json(mandates),
    "direct-debits.json": json(debits),
    "payment-providers.json": json(paymentProviders),
    "payments.json": json(payments),
    "bank-accounts.json": json(bankAccounts),
    "bank-transactions.json": json(bankTransactions),
    ...fileEntries,
  };
}

export function zip(files: Zippable): Uint8Array {
  return zipSync(files, { level: 6 });
}

export async function workspaceZip(workspaceId: string) {
  return zip(await buildWorkspaceExport(workspaceId));
}

/** Agentur-Gesamtexport: ein Ordner je Sub-Account. */
export async function agencyZip() {
  const all = await db.workspace.findMany({ select: { id: true, slug: true } });
  const files: Zippable = {};
  for (const w of all) files[w.slug] = await buildWorkspaceExport(w.id);
  return zip(files);
}

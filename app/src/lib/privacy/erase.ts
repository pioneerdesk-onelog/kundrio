import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { addrRegex } from "./match";
import { storage } from "../storage";
import { errMessage, log } from "../log";

// Löschung eines Kontakts nach Art. 17 DSGVO – EINZIGER Weg, Kontakte zu löschen (UI, Brevo-API, MCP-Freigabe).
//
// Grundsatz: alles Personenbezogene zum Kontakt verschwindet, auch Daten ohne Fremdschlüssel (Formular-Einsendungen,
// Transaktionsmails, Jobs, Prozessläufe, Analytics-Zuordnung, Freigaben, Audit-Details, Anhänge im Dateispeicher).
// Ausnahmen (Art. 17 Abs. 3 lit. b/e DSGVO, dokumentiert in docs/Datenschutz-Durchsicht 2026-10-07.md):
// - Rechnungen/Angebote (Invoice) mit Empfängerdaten: § 147 AO / § 257 HGB.
// - Versandte Belege als E-Mail (Tag „dokument“): Handelsbriefe, § 257 HGB.
// - SEPA-Mandate mit Kontoinhaber/IBAN (verschlüsselt): Nachweis gegenüber der Bank, Buchungsbeleg.
//   Weil Abos/Mandate den Kontakt brauchen, wird der Kontakt dann ANONYMISIERT statt gelöscht.
// - Sperrliste (Suppression): eine abgemeldete Adresse bleibt gesperrt, damit sie nach einem Re-Import nicht wieder
//   Werbung erhält (berechtigtes Interesse / Nachweis des Widerspruchs, Art. 21 DSGVO).
// Freitext im Wissen/Wiki (z. B. Gesprächsnotizen) wird nicht automatisch gelöscht, sondern zur Prüfung gemeldet.

export class ErasureBlockedError extends Error {}

export type ErasureResult = {
  mode: "deleted" | "anonymized" | "not_found";
  counts: Record<string, number>;
  /** Freitext-Fundstellen (Wissen, Wiki), die ein Mensch prüfen/löschen muss */
  manualReview: { kind: "knowledge" | "wiki"; id: string; title: string }[];
};

const ACTIVE_SUB = ["active", "paused"];
const ANON_NAME = "Gelöschter Kontakt";

export async function eraseContact(workspaceId: string, contactId: string, actor: string): Promise<ErasureResult> {
  const c = await db.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!c) return { mode: "not_found", counts: {}, manualReview: [] };

  const active = await db.subscription.count({ where: { workspaceId, contactId, status: { in: ACTIVE_SUB } } });
  if (active > 0) {
    throw new ErasureBlockedError(
      `Der Kontakt hat ${active === 1 ? "ein laufendes Abo" : `${active} laufende Abos`}. Bitte zuerst kündigen bzw. beenden – danach kann er gelöscht werden (Belege und Mandate bleiben wegen der Aufbewahrungspflicht anonymisiert erhalten).`,
    );
  }
  const retention = (await db.sepaMandate.count({ where: { workspaceId, contactId } })) + (await db.subscription.count({ where: { workspaceId, contactId } })) > 0;

  const email = c.email?.trim().toLowerCase() || null;
  const phone = c.phone?.trim() || null;
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const addrs = [email, phone].filter((x): x is string => !!x);
  const needles = [contactId, ...addrs]; // für JSON-/Textspalten (Job-Payload, Freigaben, Audit-Details)
  const counts: Record<string, number> = {};
  const n = (k: string, v: number) => {
    if (v) counts[k] = (counts[k] ?? 0) + v;
  };
  const fileIds = new Set<string>();

  // --- Freitext-Fundstellen melden (nicht automatisch löschen: Inhalte gehören oft mehreren Personen) ---
  const terms = [email, phone, fullName.length >= 5 ? fullName : null].filter((x): x is string => !!x).map((x) => `%${x}%`);
  const manualReview: ErasureResult["manualReview"] = [];
  if (terms.length) {
    const ks = await db.$queryRaw<{ id: string; title: string }[]>`
      SELECT DISTINCT s.id, s.title FROM "KnowledgeSource" s LEFT JOIN "KnowledgeChunk" k ON k."sourceId" = s.id
      WHERE s."workspaceId" = ${workspaceId} AND (s.content ILIKE ANY(${terms}::text[]) OR s.title ILIKE ANY(${terms}::text[]) OR k.content ILIKE ANY(${terms}::text[]))`;
    manualReview.push(...ks.map((k) => ({ kind: "knowledge" as const, id: k.id, title: k.title })));
    const ws = await db.$queryRaw<{ id: string; title: string }[]>`
      SELECT DISTINCT p.id, p.title FROM "WikiPage" p LEFT JOIN "WikiRevision" r ON r."pageId" = p.id
      WHERE p."workspaceId" = ${workspaceId} AND (p.body ILIKE ANY(${terms}::text[]) OR r.body ILIKE ANY(${terms}::text[]))`;
    manualReview.push(...ws.map((w) => ({ kind: "wiki" as const, id: w.id, title: w.title })));
  }

  await db.$transaction(
    async (tx) => {
      // --- Posteingang: Gespräche des Kontakts bzw. mit seiner Adresse/Rufnummer ---
      const convs = await tx.conversation.findMany({
        where: { workspaceId, OR: [{ contactId }, ...(addrs.length ? [{ threadKey: { in: addrs } }] : [])] },
        select: { id: true, messages: { select: { attachments: true } } },
      });
      for (const cv of convs) for (const m of cv.messages) for (const a of (m.attachments ?? []) as { fileId?: string }[]) if (a?.fileId) fileIds.add(a.fileId);
      n("Conversation", (await tx.conversation.deleteMany({ where: { id: { in: convs.map((x) => x.id) } } })).count);

      // --- Vertrieb/Service ---
      const deals = await tx.deal.findMany({ where: { workspaceId, contactId }, select: { id: true, companyId: true } });
      const dealDel = deals.filter((d) => !d.companyId).map((d) => d.id); // Deals mit Unternehmen bleiben (B2B), nur entknüpft
      const tickets = (await tx.ticket.findMany({ where: { workspaceId, contactId }, select: { id: true } })).map((t) => t.id);
      n("Task", (await tx.task.deleteMany({ where: { workspaceId, OR: [{ contactId }, { dealId: { in: dealDel } }] } })).count);
      n("Deal", (await tx.deal.deleteMany({ where: { id: { in: dealDel } } })).count);
      await tx.deal.updateMany({ where: { workspaceId, contactId }, data: { contactId: null } });
      n("Ticket", (await tx.ticket.deleteMany({ where: { id: { in: tickets } } })).count);

      // --- Termine: Kontakt als Teilnehmer entfernen; Termin löschen, wenn sonst niemand teilnimmt ---
      const evs = await tx.event.findMany({
        where: { workspaceId, OR: [{ contactId }, ...(email ? [{ attendees: { array_contains: [{ email }] } }] : [])] },
        select: { id: true, attendees: true },
      });
      for (const ev of evs) {
        const rest = ((ev.attendees ?? []) as { email?: string; contactId?: string }[]).filter(
          (a) => a.contactId !== contactId && (!email || a.email?.toLowerCase() !== email),
        );
        if (rest.length === 0) n("Event", (await tx.event.deleteMany({ where: { id: ev.id } })).count);
        else {
          await tx.event.update({ where: { id: ev.id }, data: { attendees: rest as Prisma.InputJsonValue, contactId: null } });
          n("Event.attendee", 1);
        }
      }

      // --- Formulare, E-Mails, Kampagnen, Listen, Zeitleiste, Recherche ---
      n(
        "FormSubmission",
        await tx.$executeRaw`DELETE FROM "FormSubmission" s USING "Form" f WHERE s."formId" = f.id AND f."workspaceId" = ${workspaceId}
          AND (s."contactId" = ${contactId} OR (${email}::text IS NOT NULL AND s.data::text ILIKE '%' || ${email ?? ""} || '%'))`,
      );
      // Versandte Belege (Tag „dokument“) bleiben als Handelsbrief erhalten; alles andere geht
      const mailCond = addrs.length
        ? Prisma.sql`OR "toAddr" ~* ANY(${addrs.map(addrRegex)}::text[]) OR "fromAddr" ~* ANY(${addrs.map(addrRegex)}::text[])`
        : Prisma.empty;
      n(
        "EmailMessage",
        await tx.$executeRaw`DELETE FROM "EmailMessage" WHERE "workspaceId" = ${workspaceId} AND NOT ('dokument' = ANY(tags))
          AND ("contactId" = ${contactId} ${mailCond})`,
      );
      await tx.emailMessage.updateMany({ where: { workspaceId, contactId }, data: { contactId: null } });
      n("CampaignRecipient", (await tx.campaignRecipient.deleteMany({ where: { contactId } })).count);
      n("ContactListMember", (await tx.contactListMember.deleteMany({ where: { contactId } })).count);
      n("Activity", (await tx.activity.deleteMany({ where: { workspaceId, contactId } })).count);
      n("Mention", (await tx.mention.deleteMany({ where: { workspaceId, contactId } })).count);
      n("EnrichmentSuggestion", (await tx.enrichmentSuggestion.deleteMany({ where: { workspaceId, objectType: "contact", objectId: contactId } })).count);

      // --- Prozesse, Automationen, Ereignisse, Jobs, Analytics ---
      const objects = [
        { objectType: "contact", objectId: contactId },
        ...dealDel.map((id) => ({ objectType: "deal", objectId: id })),
        ...tickets.map((id) => ({ objectType: "ticket", objectId: id })),
      ];
      n("ProcessRun", (await tx.processRun.deleteMany({ where: { workspaceId, OR: objects } })).count);
      n("CrmEvent", (await tx.crmEvent.deleteMany({ where: { workspaceId, OR: objects } })).count);
      n("AutomationRun", (await tx.automationRun.deleteMany({ where: { contactId } })).count);
      n("AnalyticsEvent.unlinked", (await tx.analyticsEvent.updateMany({ where: { workspaceId, contactId }, data: { contactId: null } })).count);
      const likeAny = needles.map((x) => `%${x}%`);
      // Jobs haben keine workspaceId – Treffer über Kontakt-ID/Adresse im Payload (laufende Jobs nicht anfassen)
      n("Job", await tx.$executeRaw`DELETE FROM "Job" WHERE status <> 'running' AND payload::text ILIKE ANY(${likeAny}::text[])`);

      // --- Nachweise behalten, Inhalte schwärzen ---
      n(
        "Approval.redacted",
        await tx.$executeRaw`UPDATE "Approval" SET title = kind || ': [personenbezogene Angaben gelöscht]', summary = NULL,
          payload = '{"redacted": true}'::jsonb, result = NULL,
          status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END
          WHERE "workspaceId" = ${workspaceId} AND (payload::text ILIKE ANY(${likeAny}::text[]) OR (${fullName} <> '' AND title ILIKE '%' || ${fullName} || '%'))`,
      );
      if (addrs.length) {
        n(
          "AuditLog.redacted",
          await tx.$executeRaw`UPDATE "AuditLog" SET detail = '{"redacted": true}'::jsonb
            WHERE "workspaceId" = ${workspaceId} AND detail::text ILIKE ANY(${addrs.map((x) => `%${x}%`)}::text[])`,
        );
      }

      // --- Sperrliste: Abmeldung überdauert die Löschung ---
      if (email && c.unsubscribedAt) {
        await tx.suppression.upsert({
          where: { workspaceId_email: { workspaceId, email } },
          create: { workspaceId, email, reason: "unsubscribed", source: "dsgvo-loeschung" },
          update: {},
        });
      }

      // --- Kundenportal-Link widerrufen ---
      const portalKey = `billing:portal:${contactId}`;
      if (retention) {
        const s = await tx.appSetting.findUnique({ where: { key: portalKey } });
        const v = ((s?.value ?? {}) as { version?: number }).version ?? 1;
        await tx.appSetting.upsert({ where: { key: portalKey }, create: { key: portalKey, value: { version: v + 1 } }, update: { value: { version: v + 1 } } });
      } else {
        await tx.appSetting.deleteMany({ where: { key: portalKey } });
      }

      // --- Kontakt selbst ---
      if (retention) {
        await tx.contact.update({
          where: { id: contactId },
          data: {
            firstName: null, lastName: ANON_NAME, jobTitle: null, socialLinks: {}, enrichedAt: null, email: null, phone: null, company: null,
            source: null, tags: ["dsgvo-geloescht"], consentEmailAt: null, consentSource: null, unsubscribedAt: null, smsConsentAt: null,
            whatsappConsentAt: null, whatsappOptOutAt: null, trustScore: null, trustSignals: Prisma.DbNull, attributes: {}, companyId: null,
            externalRef: null, notes: null,
          },
        });
      } else {
        await tx.contact.delete({ where: { id: contactId } });
      }

      // Löschnachweis (Rechenschaftspflicht Art. 5 Abs. 2) – nur IDs und Zahlen, keine Inhalte
      await tx.auditLog.create({
        data: { workspaceId, actor, action: "contact.erased", target: contactId, detail: { mode: retention ? "anonymized" : "deleted", counts, manualReview: manualReview.map((r) => ({ kind: r.kind, id: r.id })) } },
      });
    },
    { timeout: 30_000 },
  );

  // --- Anhänge im Dateispeicher: nur löschen, wenn nichts anderes mehr darauf verweist ---
  for (const fileId of fileIds) {
    try {
      const f = await db.storedFile.findFirst({ where: { id: fileId, workspaceId } });
      if (!f) continue;
      const stillUsed =
        Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Message" WHERE "workspaceId" = ${workspaceId} AND attachments::text LIKE ${`%${fileId}%`}`)[0].n) > 0 ||
        (await db.sepaMandate.count({ where: { proofFileId: fileId } })) > 0 ||
        (await db.directDebitBatch.count({ where: { fileId } })) > 0;
      if (stillUsed) continue;
      await storage().delete(f.storageKey).catch(() => undefined);
      await db.storedFile.delete({ where: { id: f.id } });
      n("StoredFile", 1);
    } catch (e) {
      log.warn("erasure: file cleanup failed", { fileId, error: errMessage(e) });
    }
  }

  return { mode: retention ? "anonymized" : "deleted", counts, manualReview };
}

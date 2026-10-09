// Konsistenzprüfungen nach dem Lauf → out/consistency.json. Liest nur.
import { PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

try { process.loadEnvFile(path.join(__dirname, "../.env")); } catch { /* optional */ }
const db = new PrismaClient();
type Check = { name: string; ok: boolean; detail: string };

async function count(sql: TemplateStringsArray, ...v: unknown[]) {
  const r = await db.$queryRaw<{ n: number }[]>(sql, ...v);
  return Number(r[0]?.n ?? 0);
}

export async function runConsistency(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, n: number, detail = "") => checks.push({ name, ok: n === 0, detail: n === 0 ? "0 Abweichungen" : `${n} Abweichungen ${detail}` });

  // Mandantentrennung: Verweise dürfen nie in einen anderen Sub-Account zeigen
  add("Kontakt → Unternehmen im selben Sub-Account", await count`SELECT count(*)::int n FROM "Contact" c JOIN "Company" co ON co.id=c."companyId" WHERE co."workspaceId"<>c."workspaceId"`);
  add("Deal → Kontakt im selben Sub-Account", await count`SELECT count(*)::int n FROM "Deal" d JOIN "Contact" c ON c.id=d."contactId" WHERE c."workspaceId"<>d."workspaceId"`);
  add("Deal → Unternehmen im selben Sub-Account", await count`SELECT count(*)::int n FROM "Deal" d JOIN "Company" c ON c.id=d."companyId" WHERE c."workspaceId"<>d."workspaceId"`);
  add("Deal → Pipeline im selben Sub-Account", await count`SELECT count(*)::int n FROM "Deal" d JOIN "Pipeline" p ON p.id=d."pipelineId" WHERE p."workspaceId"<>d."workspaceId" OR p."objectType"<>'deal'`);
  add("Ticket → Kontakt/Pipeline im selben Sub-Account", await count`SELECT count(*)::int n FROM "Ticket" t JOIN "Pipeline" p ON p.id=t."pipelineId" LEFT JOIN "Contact" c ON c.id=t."contactId" WHERE p."workspaceId"<>t."workspaceId" OR p."objectType"<>'ticket' OR (c.id IS NOT NULL AND c."workspaceId"<>t."workspaceId")`);
  add("Aufgabe → Kontakt im selben Sub-Account", await count`SELECT count(*)::int n FROM "Task" t JOIN "Contact" c ON c.id=t."contactId" WHERE c."workspaceId"<>t."workspaceId"`);
  add("Listenmitglied im selben Sub-Account", await count`SELECT count(*)::int n FROM "ContactListMember" m JOIN "ContactList" l ON l.id=m."listId" JOIN "Contact" c ON c.id=m."contactId" WHERE l."workspaceId"<>c."workspaceId"`);
  add("Zuständige haben Zugriff auf den Sub-Account", await count`SELECT count(*)::int n FROM "Contact" c JOIN "User" u ON u.id=c."ownerId" WHERE u."agencyRole" NOT IN ('owner','admin') AND NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId"=u.id AND m."workspaceId"=c."workspaceId")`);

  // Mailregeln
  add("Keine zugestellte Mail an gesperrte Adressen", await count`SELECT count(*)::int n FROM "EmailMessage" e JOIN "Suppression" s ON s."workspaceId"=e."workspaceId" AND lower(s.email)=lower(e."toAddr") WHERE e.direction='OUT' AND e.status IN ('sent','captured','delivered') AND e."createdAt" > s."createdAt"`);
  add("Keine Kampagnen-Mail an Abgemeldete", await count`SELECT count(*)::int n FROM "CampaignRecipient" r JOIN "Contact" c ON c.id=r."contactId" WHERE r.status='sent' AND c."unsubscribedAt" IS NOT NULL AND r."sentAt" > c."unsubscribedAt"`);
  add("Keine Kampagnen-Mail ohne Einwilligung", await count`SELECT count(*)::int n FROM "CampaignRecipient" r JOIN "Contact" c ON c.id=r."contactId" WHERE r.status='sent' AND c."consentEmailAt" IS NULL`);

  // Datenfluss
  add("Outbox: nichts älter als 60 s unverarbeitet", await count`SELECT count(*)::int n FROM "CrmEvent" WHERE "processedAt" IS NULL AND "createdAt" < now() - interval '60 seconds'`);
  add("Outbox: keine endgültig fehlgeschlagenen Ereignisse", await count`SELECT count(*)::int n FROM "CrmEvent" WHERE "processedAt" IS NULL AND attempts >= 5`);
  add("Prozessläufe: abgeschlossene Läufe haben Schritte", await count`SELECT count(*)::int n FROM "ProcessRun" r WHERE r.status IN ('done','goal_met') AND NOT EXISTS (SELECT 1 FROM "ProcessStepLog" s WHERE s."runId"=r.id)`);
  add("Prozessläufe: keine hängenden Läufe (> 10 min running)", await count`SELECT count(*)::int n FROM "ProcessRun" WHERE status='running' AND "updatedAt" < now() - interval '10 minutes'`);
  add("Prozessläufe: keine fehlgeschlagenen Läufe", await count`SELECT count(*)::int n FROM "ProcessRun" WHERE status='failed' AND "startedAt" > now() - interval '1 day'`, "(siehe Läufe-Protokoll)");
  add("Jobs: keine endgültig fehlgeschlagenen (24 h)", await count`SELECT count(*)::int n FROM "Job" WHERE status='failed' AND "updatedAt" > now() - interval '1 day'`);

  // Fachliche Regeln
  add("Lifecycle nur gültige Schlüssel", await count`SELECT count(*)::int n FROM "Contact" c WHERE NOT EXISTS (SELECT 1 FROM "LifecycleStage" l WHERE l."workspaceId"=c."workspaceId" AND l.key=c."lifecycleStage") AND EXISTS (SELECT 1 FROM "LifecycleStage" l2 WHERE l2."workspaceId"=c."workspaceId")`);
  add("Rechnungssummen = Positionssummen", await count`SELECT count(*)::int n FROM "Invoice" i WHERE i."netCents" <> COALESCE((SELECT sum(round((x->>'qty')::numeric * (x->>'unitCents')::numeric)) FROM jsonb_array_elements(i.items) x),0) OR i."grossCents" <> i."netCents" + i."vatCents"`);
  add("Gewonnene/verlorene Deals haben Abschlussdatum", await count`SELECT count(*)::int n FROM "Deal" d JOIN "Stage" s ON s.id=d."stageId" WHERE s.kind IN ('WON','LOST') AND d."closedAt" IS NULL`);
  add("Geschlossene Tickets haben closedAt", await count`SELECT count(*)::int n FROM "Ticket" t JOIN "Stage" s ON s.id=t."stageId" WHERE s.kind='CLOSED' AND t."closedAt" IS NULL`);
  add("Verwaiste Listenmitgliedschaften", await count`SELECT count(*)::int n FROM "ContactListMember" m LEFT JOIN "Contact" c ON c.id=m."contactId" WHERE c.id IS NULL`);

  // Posteingang
  add("Posteingang: keine Nachricht ohne Gespräch", await count`SELECT count(*)::int n FROM "Message" m LEFT JOIN "Conversation" c ON c.id=m."conversationId" WHERE c.id IS NULL`);
  add("Posteingang: Nachricht und Gespräch im selben Sub-Account", await count`SELECT count(*)::int n FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId" WHERE c."workspaceId"<>m."workspaceId"`);
  add("Posteingang: Gespräch → Kanal/Kontakt im selben Sub-Account", await count`SELECT count(*)::int n FROM "Conversation" c JOIN "Inbox" i ON i.id=c."inboxId" LEFT JOIN "Contact" k ON k.id=c."contactId" WHERE i."workspaceId"<>c."workspaceId" OR (k.id IS NOT NULL AND k."workspaceId"<>c."workspaceId")`);
  add("Posteingang: Zuständige haben Zugriff auf den Sub-Account", await count`SELECT count(*)::int n FROM "Conversation" c JOIN "User" u ON u.id=c."assigneeId" WHERE u."agencyRole" NOT IN ('owner','admin') AND NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId"=u.id AND m."workspaceId"=c."workspaceId")`);

  // Abos & SEPA
  add("Abos: keine doppelte Rechnung je Periode", await count`SELECT count(*)::int n FROM (SELECT 1 FROM "Invoice" WHERE kind='INVOICE' AND "subscriptionId" IS NOT NULL AND status<>'CANCELLED' GROUP BY "subscriptionId", "serviceFrom" HAVING count(*) > 1) d`);
  add("Abos: Rechnung → Abo im selben Sub-Account", await count`SELECT count(*)::int n FROM "Invoice" i JOIN "Subscription" s ON s.id=i."subscriptionId" WHERE s."workspaceId"<>i."workspaceId"`);
  add("Mandate: IBAN nur verschlüsselt (v1.…, AES-GCM)", await count`SELECT count(*)::int n FROM "SepaMandate" WHERE "ibanEncrypted" !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' OR "ibanEncrypted" ~ '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}' OR "ibanLast4" !~ '^[A-Z0-9]{4}$'`);
  add("Keine Klartext-IBAN in Audit-Log und Aktivitäten", await count`SELECT (SELECT count(*) FROM "AuditLog" WHERE detail::text ~ '"[A-Z]{2}[0-9]{2} ?([A-Z0-9]{4} ?){3,7}[A-Z0-9]{1,4}"') + (SELECT count(*) FROM "Activity" WHERE meta::text ~ '[A-Z]{2}[0-9]{2}([A-Z0-9]{4}){3,7}')::int n`);

  // Zahlungen & Kontoabgleich
  const SEALED = "^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$";
  add("Zahlungsanbieter: Zugangsdaten nur verschlüsselt", await count`SELECT count(*)::int n FROM "PaymentProvider" WHERE credentials !~ ${SEALED}`);
  add("Bankkonten: Zugangsdaten nur verschlüsselt", await count`SELECT count(*)::int n FROM "BankAccount" WHERE credentials IS NOT NULL AND credentials !~ ${SEALED}`);
  add("Zahlungen: Anbieter und Rechnung im selben Sub-Account", await count`SELECT count(*)::int n FROM "Payment" p JOIN "PaymentProvider" v ON v.id=p."providerId" LEFT JOIN "Invoice" i ON i.id=p."invoiceId" WHERE v."workspaceId"<>p."workspaceId" OR (i.id IS NOT NULL AND i."workspaceId"<>p."workspaceId")`);
  add("Zahlungen: erstattet ≤ gezahlt, Beträge positiv", await count`SELECT count(*)::int n FROM "Payment" WHERE "amountCents"<=0 OR "refundedCents"<0 OR "refundedCents">"amountCents"`);
  add("Kontoabgleich: Status matched ⇔ Rechnung zugeordnet (selber Sub-Account)", await count`SELECT count(*)::int n FROM "BankTransaction" t LEFT JOIN "Invoice" i ON i.id=t."matchedInvoiceId" WHERE (t.status='matched' AND (i.id IS NULL OR i."workspaceId"<>t."workspaceId")) OR (t.status IN ('unmatched','ignored') AND t."matchedInvoiceId" IS NOT NULL)`);
  add("Bezahlt-Ereignis → Rechnung (kein Entwurf) im selben Sub-Account", await count`SELECT count(*)::int n FROM "CrmEvent" e LEFT JOIN "Invoice" i ON i.id=e."objectId" WHERE e.type='invoice.paid' AND (i.id IS NULL OR i.kind<>'INVOICE' OR i.status='DRAFT' OR i."workspaceId"<>e."workspaceId")`);

  // Buchungen
  add("Buchungen: keine Überschneidung je Gastgeber", await count`SELECT count(*)::int n FROM "Event" a JOIN "Event" b ON a."ownerId"=b."ownerId" AND a.id<b.id AND a."startsAt"<b."endsAt" AND b."startsAt"<a."endsAt" WHERE a.source='booking' AND b.source='booking' AND a.status='scheduled' AND b.status='scheduled'`);
  add("Buchungen: Termin → Terminvorlage im selben Sub-Account", await count`SELECT count(*)::int n FROM "Event" e JOIN "MeetingType" m ON m.id=e."meetingTypeId" WHERE m."workspaceId"<>e."workspaceId"`);

  // Datenschutz
  add("Analytics ohne IP-Adressen", await count`SELECT count(*)::int n FROM "AnalyticsEvent" WHERE path ~ '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}' OR "visitorHash" ~ '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}'`);
  add("Analytics ohne Query-Strings", await count`SELECT count(*)::int n FROM "AnalyticsEvent" WHERE path LIKE '%?%'`);
  add("Sitzungstoken nur gehasht (64 hex)", await count`SELECT count(*)::int n FROM "Session" WHERE "tokenHash" !~ '^[0-9a-f]{64}$'`);
  add("API-Schlüssel nur gehasht", await count`SELECT count(*)::int n FROM "ApiKey" WHERE hash !~ '^[0-9a-f]{64}$'`);
  add("Audit-Log ohne E-Mail-Inhalte", await count`SELECT count(*)::int n FROM "AuditLog" WHERE detail::text ~* '"(htmlContent|textContent|password|token)"'`);
  return checks;
}

if (require.main === module) {
  runConsistency()
    .then((c) => {
      mkdirSync(path.join(__dirname, "out"), { recursive: true });
      writeFileSync(path.join(__dirname, "out/consistency.json"), JSON.stringify(c, null, 2));
      for (const x of c) console.log(`${x.ok ? "✅" : "❌"} ${x.name}: ${x.detail}`);
    })
    .finally(() => db.$disconnect());
}

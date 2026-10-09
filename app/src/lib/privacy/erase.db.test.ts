// DB-Integrationstest Löschung nach Art. 17 DSGVO. Läuft nur mit Datenbank (Sub-Account „e2e“ muss existieren):
//   node --env-file=.env node_modules/vitest/vitest.mjs run src/lib/privacy/erase.db.test.ts
// Legt Testkontakte mit möglichst vielen verknüpften Daten an, löscht sie über eraseContact() und durchsucht danach
// JEDE Tabelle (Zeile als Text) nach E-Mail, Name, Rufnummer und Kontakt-ID. Räumt am Ende alles wieder ab.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enabled = !!process.env.DATABASE_URL && process.env.MAIL_MODE !== "smtp";
const tag = `ds${Date.now().toString(36)}`;

type Db = typeof import("../db").db;
let db: Db;
let wsId = "";
let actor = "user:dsgvo-test";
const cleanup: (() => Promise<unknown>)[] = [];
// Kontakte zuletzt löschen (Abos/Mandate verweisen mit Restrict auf sie)
const finalCleanup: (() => Promise<unknown>)[] = [];

type Marker = { contactId: string; email: string; lastName: string; phone: string };

/** Zählt je Tabelle die Zeilen, deren Textdarstellung `needle` enthält (Groß/klein egal). */
async function scanAllTables(needle: string): Promise<Record<string, number>> {
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT table_name AS t FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    const r = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}" x WHERE x::text ILIKE $1`, `%${needle}%`);
    const n = Number(r[0]?.n ?? 0);
    if (n > 0) out[t] = n;
  }
  return out;
}

async function seedContact(n: number, opts: { billing: boolean; activeSubscription?: boolean }): Promise<Marker> {
  const { encryptIban } = await import("../billing/crypto");
  const { storeFile } = await import("../storage");
  const suffix = `${tag}n${n}`;
  const email = `loeschprobe-${suffix}@example.invalid`;
  const lastName = `Loeschprobe${suffix}`;
  const phone = `+49151${Date.now().toString().slice(-7)}${n}`;
  const c = await db.contact.create({
    data: {
      workspaceId: wsId, firstName: "Ellinor", lastName, email, phone, company: "Probe GmbH", jobTitle: "Einkauf",
      socialLinks: { linkedin: `https://www.linkedin.com/in/${lastName}` }, tags: ["dsgvo-test"], notes: `Notiz zu ${lastName}`,
      consentEmailAt: new Date(), consentSource: "DOI Formular Test", unsubscribedAt: new Date(), smsConsentAt: new Date(),
      trustScore: 80, trustSignals: { signals: [{ key: "mx", label: email, impact: 5 }] }, attributes: { CITY: "Probestadt" },
    },
  });
  const contactId = c.id;
  const who = `Ellinor ${lastName}`;

  await db.activity.create({ data: { workspaceId: wsId, contactId, type: "NOTE", body: `Telefonat mit ${who}` } });

  // Pipeline-Objekte
  const dealPipe = await db.pipeline.findFirstOrThrow({ where: { workspaceId: wsId, objectType: "deal" }, include: { stages: true } });
  const ticketPipe = await db.pipeline.findFirstOrThrow({ where: { workspaceId: wsId, objectType: "ticket" }, include: { stages: true } });
  const deal = await db.deal.create({ data: { workspaceId: wsId, pipelineId: dealPipe.id, stageId: dealPipe.stages[0].id, contactId, title: `Website für ${who}` } });
  await db.task.create({ data: { workspaceId: wsId, contactId, dealId: deal.id, title: `${who} zurückrufen` } });
  const ticket = await db.ticket.create({
    data: { workspaceId: wsId, pipelineId: ticketPipe.id, stageId: ticketPipe.stages[0].id, contactId, subject: `Frage von ${who}`, description: `Rückruf an ${phone}` },
  });

  // Termin mit Teilnehmerliste
  await db.event.create({
    data: { workspaceId: wsId, contactId, title: `Erstgespräch ${who}`, startsAt: new Date(Date.now() - 864e5), endsAt: new Date(Date.now() - 864e5 + 1800e3), attendees: [{ email, name: who, contactId }], source: "booking" },
  });

  // Formular-Einsendungen (mit und ohne Kontakt-Verknüpfung)
  const form = await db.form.create({ data: { workspaceId: wsId, name: `DSGVO-Test ${suffix}`, fields: [{ key: "email", label: "E-Mail", type: "email" }] } });
  cleanup.push(() => db.form.deleteMany({ where: { id: form.id } }));
  await db.formSubmission.create({ data: { formId: form.id, contactId, data: { email, name: who } } });
  await db.formSubmission.create({ data: { formId: form.id, data: { email, nachricht: "frühere Anfrage ohne Kontakt" } } });

  // E-Mails: 1:1, Transaktionsmail ohne Kontakt-ID, versandter Beleg (Handelsbrief → bleibt)
  const mail = await db.emailMessage.create({ data: { workspaceId: wsId, contactId, direction: "OUT", fromAddr: "team@example.invalid", toAddr: email, subject: `Hallo ${who}`, bodyText: `Guten Tag ${who}` } });
  await db.emailEvent.create({ data: { workspaceId: wsId, messageId: mail.id, event: "delivered", reason: `250 OK ${email}` } });
  await db.emailMessage.create({ data: { workspaceId: wsId, direction: "OUT", kind: "transactional", fromAddr: "team@example.invalid", toAddr: `"${who}" <${email}>`, subject: "Ihre Anfrage", bodyText: "…" } });

  // Kampagne, Liste
  const camp = await db.campaign.create({ data: { workspaceId: wsId, name: `DSGVO-Test ${suffix}`, subject: "Test", bodyMarkdown: "Test" } });
  cleanup.push(() => db.campaign.deleteMany({ where: { id: camp.id } }));
  await db.campaignRecipient.create({ data: { campaignId: camp.id, contactId, status: "sent" } });
  const list = await db.contactList.create({ data: { workspaceId: wsId, name: `DSGVO-Test ${suffix}` } });
  cleanup.push(() => db.contactList.deleteMany({ where: { id: list.id } }));
  await db.contactListMember.create({ data: { listId: list.id, contactId } });

  // Posteingang: Gespräch, Nachricht mit Anhang (Datei im Speicher)
  const inbox = await db.inbox.create({ data: { workspaceId: wsId, name: `DSGVO-Test ${suffix}`, kind: "email", address: `inbox-${suffix}@example.invalid`, provider: "imap", active: false } });
  cleanup.push(() => db.inbox.deleteMany({ where: { id: inbox.id } }));
  const { file } = await storeFile({ workspaceId: wsId, kind: "document", name: `anhang-${suffix}.txt`, data: new TextEncoder().encode(`Lebenslauf ${who} ${suffix}`) });
  cleanup.push(async () => {
    const { deleteStoredFile } = await import("../storage");
    await deleteStoredFile(wsId, file.id).catch(() => undefined);
  });
  const conv = await db.conversation.create({ data: { workspaceId: wsId, inboxId: inbox.id, contactId, subject: `Anfrage ${who}`, threadKey: `<${suffix}@example.invalid>` } });
  await db.message.create({
    data: { workspaceId: wsId, conversationId: conv.id, direction: "in", channel: "email", fromAddr: email, toAddrs: [inbox.address], subject: `Anfrage ${who}`, bodyText: `Viele Grüße, ${who}, ${phone}`, attachments: [{ fileId: file.id, name: file.name, mime: file.mime, size: file.size }] },
  });

  // Recherche: Erwähnung, Anreicherungsvorschlag
  await db.mention.create({ data: { workspaceId: wsId, contactId, url: `https://presse.example/${suffix}`, title: `${who} wird Einkaufsleiterin`, sourceKind: "searxng", snippet: who } });
  await db.enrichmentSuggestion.create({ data: { workspaceId: wsId, objectType: "contact", objectId: contactId, field: "jobTitle", value: `Einkauf (${who})`, sourceKind: "searxng" } });

  // Ereignisse/Prozesse/Automationen/Jobs/Freigaben/Analytics
  await db.crmEvent.create({ data: { workspaceId: wsId, type: "contact.created", objectType: "contact", objectId: contactId, data: { source: "manual" }, processedAt: new Date() } });
  await db.crmEvent.create({ data: { workspaceId: wsId, type: "ticket.created", objectType: "ticket", objectId: ticket.id, data: {}, processedAt: new Date() } });
  const proc = await db.process.create({ data: { workspaceId: wsId, name: `DSGVO-Test ${suffix}`, objectType: "contact" } });
  cleanup.push(() => db.process.deleteMany({ where: { id: proc.id } }));
  const ver = await db.processVersion.create({ data: { processId: proc.id, version: 1, definition: {} } });
  const run = await db.processRun.create({ data: { workspaceId: wsId, processId: proc.id, versionId: ver.id, objectType: "contact", objectId: contactId, status: "done", dedupeKey: `dsgvo-${suffix}`, context: { email } } });
  await db.processStepLog.create({ data: { runId: run.id, nodeId: "n1", nodeType: "email", status: "ok", detail: { to: email } } });
  const auto = await db.automation.create({ data: { workspaceId: wsId, name: `DSGVO-Test ${suffix}`, trigger: "FORM_SUBMITTED" } });
  cleanup.push(() => db.automation.deleteMany({ where: { id: auto.id } }));
  await db.automationRun.create({ data: { automationId: auto.id, contactId, status: "done", log: [{ to: email }] } });
  const job = await db.job.create({ data: { type: "trust.score", payload: { contactId }, status: "done" } });
  cleanup.push(() => db.job.deleteMany({ where: { id: job.id } }));
  const appr = await db.approval.create({ data: { workspaceId: wsId, kind: "contact.delete", title: `Kontakt löschen: ${who}`, summary: "Grund: Test", payload: { contactId, reason: "Test" }, requestedBy: actor } });
  cleanup.push(() => db.approval.deleteMany({ where: { id: appr.id } }));
  await db.analyticsEvent.create({ data: { workspaceId: wsId, kind: "conversion", name: "lead", path: "/", contactId } });
  await db.auditLog.create({ data: { workspaceId: wsId, actor, action: "inbox.reply", target: conv.id, detail: { to: email } } });

  // Wissen: Freitext mit dem Namen (wird nicht automatisch gelöscht, nur zur Prüfung gemeldet)
  const src = await db.knowledgeSource.create({ data: { workspaceId: wsId, kind: "text", title: `Gesprächsnotiz ${suffix}`, content: `Gespräch mit ${who} über Preise.`, status: "indexed" } });
  cleanup.push(() => db.knowledgeSource.deleteMany({ where: { id: src.id } }));
  const vec = `[${Array.from({ length: 1024 }, () => "0.01").join(",")}]`;
  await db.$executeRawUnsafe(
    `INSERT INTO "KnowledgeChunk" (id, "workspaceId", "sourceId", position, content, embedding, "embedModel") VALUES ($1, $2, $3, 0, $4, $5::vector, 'test')`,
    `kc-${suffix}`, wsId, src.id, `Gespräch mit ${who} über Preise.`, vec,
  );

  if (opts.billing) {
    // Beleg + Mandat + Abo (Aufbewahrungspflicht) + versandter Beleg als E-Mail
    const inv = await db.invoice.create({
      data: { workspaceId: wsId, contactId, kind: "INVOICE", number: `DS-${suffix}`, status: "SENT", buyerName: who, buyerEmail: email, buyerAddress: "Probeweg 1, 12345 Probestadt", grossCents: 1190, netCents: 1000, vatCents: 190 },
    });
    cleanup.push(() => db.invoice.deleteMany({ where: { id: inv.id } }));
    await db.emailMessage.create({ data: { workspaceId: wsId, contactId, direction: "OUT", kind: "one_to_one", tags: ["dokument", "invoice"], fromAddr: "team@example.invalid", toAddr: email, subject: `Rechnung DS-${suffix}`, bodyText: `Guten Tag ${who}, anbei die Rechnung.` } });
    const mandate = await db.sepaMandate.create({
      data: { workspaceId: wsId, contactId, mandateRef: `DS-${suffix}`, accountHolder: who, ibanEncrypted: encryptIban("DE02120300000000202051"), ibanLast4: "2051", signedAt: new Date(), status: opts.activeSubscription ? "active" : "revoked" },
    });
    const sub = await db.subscription.create({
      data: { workspaceId: wsId, contactId, mandateId: mandate.id, status: opts.activeSubscription ? "active" : "ended", startDate: new Date(), nextBillingDate: new Date(Date.now() + 30 * 864e5), paymentMethod: "sepa" },
    });
    cleanup.push(() => db.subscription.deleteMany({ where: { id: sub.id } }));
    cleanup.push(() => db.sepaMandate.deleteMany({ where: { id: mandate.id } }));
  }
  finalCleanup.push(() => db.contact.deleteMany({ where: { id: contactId } }));
  cleanup.push(() => db.suppression.deleteMany({ where: { workspaceId: wsId, email } }));
  cleanup.push(() => db.emailMessage.deleteMany({ where: { workspaceId: wsId, toAddr: { contains: email } } }));
  cleanup.push(() => db.auditLog.deleteMany({ where: { workspaceId: wsId, OR: [{ target: contactId }, { actor }] } }));
  cleanup.push(() => db.appSetting.deleteMany({ where: { key: { contains: contactId } } }));
  return { contactId, email, lastName, phone };
}

describe.skipIf(!enabled)("Löschung eines Kontakts (Art. 17 DSGVO, DB)", () => {
  beforeAll(async () => {
    db = (await import("../db")).db;
    const ws = await db.workspace.findUnique({ where: { slug: "e2e" } });
    if (!ws) throw new Error("Sub-Account „e2e“ fehlt – zuerst npm run e2e:seed");
    wsId = ws.id;
    actor = `user:dsgvo-test-${tag}`;
  });

  afterAll(async () => {
    for (const f of [...cleanup.reverse(), ...finalCleanup]) await f().catch(() => undefined);
    await db.$disconnect();
  });

  it("ohne Aufbewahrungspflicht: nichts Personenbezogenes bleibt übrig (außer Sperrliste und gemeldetem Freitext)", async () => {
    const { eraseContact } = await import("./erase");
    const m = await seedContact(1, { billing: false });

    // Auskunft (Art. 15) vor der Löschung: alle Bereiche enthalten, auch Daten ohne Fremdschlüssel
    const { buildContactAccessReport } = await import("./access");
    const rep = await buildContactAccessReport(wsId, m.contactId);
    expect(rep?.stammdaten.email).toBe(m.email);
    expect(rep?.einwilligungen.emailEinwilligungQuelle).toBe("DOI Formular Test");
    expect(rep?.formularEinsendungen).toHaveLength(2);
    expect(rep?.emails).toHaveLength(2);
    expect(rep?.emails.find((e) => e.ereignisse.length === 1)).toBeTruthy();
    expect(rep?.gespraeche[0].messages).toHaveLength(1);
    expect(rep?.termine).toHaveLength(1);
    expect(rep?.tickets).toHaveLength(1);
    expect(rep?.erwaehnungen).toHaveLength(1);
    expect(rep?.anreicherungsVorschlaege).toHaveLength(1);
    expect(rep?.prozessLaeufe).toHaveLength(1);
    expect(rep?.automationsLaeufe).toHaveLength(1);
    expect(rep?.analyticsZuordnung).toHaveLength(1);
    expect(rep?.kampagnen).toHaveLength(1);
    expect(rep?.listen).toHaveLength(1);

    const res = await eraseContact(wsId, m.contactId, actor);
    expect(res.mode).toBe("deleted");

    const byEmail = await scanAllTables(m.email);
    const byName = await scanAllTables(m.lastName);
    const byPhone = await scanAllTables(m.phone);
    const byId = await scanAllTables(m.contactId);
    // Sperrliste: Abmeldung muss die Löschung überdauern (sonst nach Re-Import wieder anschreibbar)
    expect(byEmail).toEqual({ Suppression: 1 });
    // Freitext im Wissen wird nicht automatisch gelöscht, aber gemeldet
    expect(byName).toEqual({ KnowledgeSource: 1, KnowledgeChunk: 1 });
    expect(res.manualReview.map((r) => r.kind).sort()).toEqual(["knowledge"]);
    expect(byPhone).toEqual({});
    // Kontakt-ID bleibt nur im Löschnachweis (Audit, ohne personenbezogene Inhalte)
    expect(byId).toEqual({ AuditLog: 1 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { workspaceId: wsId, target: m.contactId } });
    expect(audit.action).toBe("contact.erased");
    // Datei des Anhangs ist auch im Speicher gelöscht
    expect(await db.storedFile.count({ where: { workspaceId: wsId, name: { contains: `${tag}n1` } } })).toBe(0);
  }, 60_000);

  it("mit Belegen/Mandat: Kontakt wird anonymisiert, Belege bleiben (HGB/AO), alles andere ist weg", async () => {
    const { eraseContact } = await import("./erase");
    const m = await seedContact(2, { billing: true });
    const res = await eraseContact(wsId, m.contactId, actor);
    expect(res.mode).toBe("anonymized");

    const c = await db.contact.findUniqueOrThrow({ where: { id: m.contactId } });
    expect(c.email).toBeNull();
    expect(c.phone).toBeNull();
    expect(c.firstName).toBeNull();

    const byEmail = await scanAllTables(m.email);
    const byName = await scanAllTables(m.lastName);
    // Bleiben dürfen: Rechnung (Empfänger), Mandat (Kontoinhaber), versandter Beleg (Handelsbrief), Sperrliste, gemeldetes Wissen
    expect(byEmail).toEqual({ Invoice: 1, EmailMessage: 1, Suppression: 1 });
    expect(byName).toEqual({ Invoice: 1, EmailMessage: 1, SepaMandate: 1, KnowledgeSource: 1, KnowledgeChunk: 1 });
    expect(await scanAllTables(m.phone)).toEqual({});
    const kept = await db.emailMessage.findFirstOrThrow({ where: { workspaceId: wsId, toAddr: m.email } });
    expect(kept.tags).toContain("dokument");
    // Kundenportal-Link ist widerrufen
    const { portalVersion } = await import("../billing/portal");
    expect(await portalVersion(m.contactId)).toBeGreaterThan(1);
  }, 60_000);

  it("laufendes Abo verhindert die Löschung mit verständlicher Meldung", async () => {
    const { eraseContact, ErasureBlockedError } = await import("./erase");
    const m = await seedContact(3, { billing: true, activeSubscription: true });
    await expect(eraseContact(wsId, m.contactId, actor)).rejects.toBeInstanceOf(ErasureBlockedError);
    expect(await db.contact.count({ where: { id: m.contactId, email: m.email } })).toBe(1);
    // Nach Ende des Abos geht es (und räumt die Testdaten ab)
    await db.subscription.updateMany({ where: { contactId: m.contactId }, data: { status: "ended" } });
    expect((await eraseContact(wsId, m.contactId, actor)).mode).toBe("anonymized");
  }, 60_000);
});


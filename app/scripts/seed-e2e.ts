// E2E-Testdaten: eigener Sub-Account „E2E Testmandant“ (slug e2e) mit Testbenutzern je Rolle und
// realitätsnahen Datensätzen (max. 10 je Objekt). Fiktive Firmen nur unter example.*.
// Echte Empfänger ausschließlich aus .env: E2E_INTERNAL_EMAIL (Google), E2E_CUSTOMER_EMAIL (Microsoft).
//
//   npm run e2e:seed    – Testmandant neu aufbauen (vorher vollständig entfernen → idempotent)
//   npm run e2e:reset   – Testmandant und Testbenutzer restlos entfernen
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../src/lib/password";
import { PRESETS, PRESET_KEYS } from "../src/lib/permissions/catalog";
import { DEFAULT_LIFECYCLE, TICKET_STAGES, SLA_HOURS } from "../src/lib/objects/lifecycle";
import { ensureDefaultProcesses } from "../src/lib/process/defaults";
import { checkPage } from "../src/lib/p-a11y";
import { chunkText } from "../src/lib/chunk";
import { embed, toVectorLiteral } from "../src/lib/ollama";

const db = new PrismaClient();
const SLUG = "e2e";
const USER_DOMAIN = "pioneerdesk.test";
const AUTH_DIR = path.join(__dirname, "../e2e/.auth");
const DAY = 864e5;
const now = Date.now();
const days = (n: number) => new Date(now + n * DAY);

/** Testbenutzer: key → Agentur-Rolle und/oder Sub-Account-Rolle + Team */
export const E2E_USERS = [
  { key: "agentur-admin", name: "Anna Agentur (Admin)", agencyRole: "admin", role: null, team: null },
  { key: "agentur-mitarbeiter", name: "Moritz Mitarbeiter (Agentur)", agencyRole: "member", role: "teamleitung", team: null },
  { key: "admin", name: "Andrea Admin", agencyRole: "member", role: "admin", team: null },
  { key: "teamleitung", name: "Tobias Teamleitung", agencyRole: "member", role: "teamleitung", team: "Vertrieb Süd" },
  { key: "vertrieb-a", name: "Vera Vertrieb (Süd)", agencyRole: "member", role: "vertrieb", team: "Vertrieb Süd" },
  { key: "vertrieb-b", name: "Benedikt Vertrieb (Süd)", agencyRole: "member", role: "vertrieb", team: "Vertrieb Süd" },
  { key: "vertrieb-c", name: "Carla Vertrieb (Nord)", agencyRole: "member", role: "vertrieb", team: "Vertrieb Nord" },
  { key: "service", name: "Sven Service", agencyRole: "member", role: "service", team: null },
  { key: "marketing", name: "Mia Marketing", agencyRole: "member", role: "marketing", team: null },
  { key: "buchhaltung", name: "Bernd Buchhaltung", agencyRole: "member", role: "buchhaltung", team: null },
  { key: "nurlesen", name: "Lena Lesend", agencyRole: "member", role: "nurlesen", team: null },
] as const;
export type E2EUserKey = (typeof E2E_USERS)[number]["key"];
export const e2eEmail = (key: string) => `e2e.${key}@${USER_DOMAIN}`;

// ---------- Entfernen ----------

async function reset() {
  const ws = await db.workspace.findUnique({ where: { slug: SLUG } });
  const userEmails = { endsWith: `@${USER_DOMAIN}` };
  if (ws) {
    // Jobs und Einstellungen hängen nicht per FK am Workspace
    await db.$executeRaw`DELETE FROM "Job" WHERE payload->>'workspaceId' = ${ws.id}`;
    await db.appSetting.deleteMany({ where: { key: { contains: ws.id } } });
    await db.workspace.delete({ where: { id: ws.id } }); // Cascade: alle fachlichen Tabellen
  }
  const users = await db.user.findMany({ where: { email: userEmails }, select: { id: true } });
  if (users.length) {
    const ids = users.map((u) => u.id);
    await db.auditLog.deleteMany({ where: { OR: ids.map((id) => ({ actor: { contains: id } })) } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.invitation.deleteMany({ where: { email: userEmails } });
  return { removedWorkspace: !!ws, removedUsers: users.length };
}

// ---------- Aufbau ----------

async function seed() {
  const internal = process.env.E2E_INTERNAL_EMAIL?.trim().toLowerCase();
  const customer = process.env.E2E_CUSTOMER_EMAIL?.trim().toLowerCase();
  if (!internal || !customer) throw new Error("E2E_INTERNAL_EMAIL und E2E_CUSTOMER_EMAIL müssen in app/.env gesetzt sein.");

  await reset();
  const agency = await db.agency.findFirstOrThrow();
  const ws = await db.workspace.create({
    data: {
      agencyId: agency.id,
      slug: SLUG,
      name: "E2E Testmandant",
      domain: "e2e.pioneerdesk.test",
      description: "Automatischer Abnahmetest – wird bei jedem Lauf neu aufgebaut.",
      brandPrimary: "#0B4F6C",
      brandAccent: "#F2913A",
      mailFromName: "Pioneerdesk Testmandant",
      // Absender für echten Testversand (z. B. Google-Konto); sonst Testdomain → nur Mailpit
      mailFromEmail: process.env.E2E_SENDER_EMAIL || "info@e2e.pioneerdesk.test",
      region: "DE",
      languages: ["de", "en"],
      // Domain des echten Testabsenders zulassen (Absender-Prüfung der Mail-API)
      allowedOrigins: ["https://www.e2e.pioneerdesk.test", ...(process.env.E2E_SENDER_EMAIL ? [`https://${process.env.E2E_SENDER_EMAIL.split("@")[1]}`] : [])],
      legalName: "Pioneerdesk Testmandant GmbH",
      legalAddress: "Musterstraße 12\n85354 Freising",
      legalPhone: "+49 8161 000000",
      legalEmail: "rechnung@e2e.pioneerdesk.test",
      vatId: "DE123456789",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      imprint: "Pioneerdesk Testmandant GmbH · Musterstraße 12 · 85354 Freising · Testdaten, keine echte Firma.",
      agentApiEnabled: true,
      fourEyes: false,
    },
  });

  // Rollen aus Vorlagen
  const roleIds: Record<string, string> = {};
  for (const key of PRESET_KEYS) {
    const p = PRESETS[key];
    const r = await db.role.create({ data: { workspaceId: ws.id, key, name: p.name, description: p.description, presetKey: key, permissions: p.permissions } });
    roleIds[key] = r.id;
  }

  // Lifecycle, Pipelines, Standardprozesse
  await db.lifecycleStage.createMany({ data: DEFAULT_LIFECYCLE.map((s, i) => ({ workspaceId: ws.id, key: s.key, label: s.label, position: i })) });
  const dealStages = [
    { name: "Neu", kind: "OPEN" },
    { name: "Kontaktiert", kind: "OPEN" },
    { name: "Qualifiziert", kind: "OPEN" },
    { name: "Angebot", kind: "OPEN" },
    { name: "Gewonnen", kind: "WON" },
    { name: "Verloren", kind: "LOST" },
  ] as const;
  const dealPipe = await db.pipeline.create({
    data: { workspaceId: ws.id, name: "Vertrieb", objectType: "deal", stages: { create: dealStages.map((s, i) => ({ ...s, position: i })) } },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  const ticketPipe = await db.pipeline.create({
    data: { workspaceId: ws.id, name: "Support", objectType: "ticket", stages: { create: TICKET_STAGES.map((s, i) => ({ ...s, position: i })) } },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  const processes = await ensureDefaultProcesses(db, ws.id);

  // Benutzer je Rolle
  const password = process.env.E2E_PASSWORD || randomBytes(15).toString("base64url");
  const passwordHash = await hashPassword(password);
  const users: Record<string, string> = {};
  for (const u of E2E_USERS) {
    const isStaff = u.agencyRole === "admin";
    const user = await db.user.create({
      data: { email: e2eEmail(u.key), name: u.name, passwordHash, agencyRole: u.agencyRole, isAgencyAdmin: isStaff, active: true },
    });
    users[u.key] = user.id;
    if (u.role) {
      await db.membership.create({ data: { userId: user.id, workspaceId: ws.id, roleId: roleIds[u.role], role: u.role === "admin" ? "ADMIN" : "MEMBER" } });
    }
  }
  const teams: Record<string, string> = {};
  for (const name of ["Vertrieb Süd", "Vertrieb Nord"]) teams[name] = (await db.team.create({ data: { workspaceId: ws.id, name } })).id;
  for (const u of E2E_USERS) if (u.team) await db.teamMember.create({ data: { teamId: teams[u.team], userId: users[u.key] } });
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(
    path.join(AUTH_DIR, "credentials.json"),
    JSON.stringify({ password, users: Object.fromEntries(E2E_USERS.map((u) => [u.key, { email: e2eEmail(u.key), name: u.name, role: u.role, agencyRole: u.agencyRole, team: u.team }])) }, null, 2),
    { mode: 0o600 },
  );

  // Eigene Felder
  await db.propertyDefinition.createMany({
    data: [
      { workspaceId: ws.id, objectType: "contact", key: "BRANCHE", label: "Branche", type: "select", options: ["Maschinenbau", "Logistik", "Elektrotechnik", "Hotellerie", "Steuerberatung", "Medizintechnik", "Bau", "IT-Service"] },
      { workspaceId: ws.id, objectType: "contact", key: "KUNDENNUMMER", label: "Kundennummer", type: "text" },
      { workspaceId: ws.id, objectType: "company", key: "MITARBEITER", label: "Mitarbeitende", type: "number" },
    ],
  });

  // Unternehmen (9)
  const companySpecs = [
    { k: "brenner", name: "Brenner Maschinenbau GmbH", domain: "brenner-maschinenbau.example.de", industry: "Maschinenbau", size: "120", owner: "vertrieb-a" },
    { k: "huber", name: "Huber Logistik KG", domain: "huber-logistik.example.de", industry: "Logistik", size: "45", owner: "vertrieb-b" },
    { k: "seidl", name: "Seidl Elektrotechnik GmbH", domain: "seidl-elektro.example.de", industry: "Elektrotechnik", size: "30", owner: "vertrieb-c" },
    { k: "alpenblick", name: "Alpenblick Hotels GmbH", domain: "alpenblick-hotels.example.com", industry: "Hotellerie", size: "210", owner: "vertrieb-a" },
    { k: "kraus", name: "Kraus Steuerberatung PartG mbB", domain: "kraus-stb.example.de", industry: "Steuerberatung", size: "12", owner: null },
    { k: "weber", name: "Weber Medizintechnik AG", domain: "weber-medtech.example.de", industry: "Medizintechnik", size: "380", owner: "teamleitung" },
    { k: "lindner", name: "Lindner Bau GmbH", domain: "lindner-bau.example.de", industry: "Bau", size: "65", owner: "vertrieb-c" },
    { k: "gruber", name: "Gruber IT-Service e.K.", domain: "gruber-it.example.com", industry: "IT-Service", size: "8", owner: "vertrieb-b" },
    { k: "one", name: "Testkundin GmbH (Test)", domain: customer.split("@")[1], industry: "IT-Service", size: "5", owner: "vertrieb-a" },
  ] as const;
  const companies: Record<string, string> = {};
  for (const c of companySpecs) {
    const co = await db.company.create({
      data: {
        workspaceId: ws.id, name: c.name, domain: c.domain, industry: c.industry, size: c.size, website: `https://${c.domain}`,
        ownerId: c.owner ? users[c.owner] : null, attributes: { MITARBEITER: Number(c.size) },
        lifecycleStage: c.k === "one" || c.k === "weber" ? "customer" : null,
      },
    });
    companies[c.k] = co.id;
  }

  // Kontakte (10) – nur zwei echte Adressen
  const consent = (src: string) => ({ consentEmailAt: days(-30), consentSource: src });
  const contactSpecs = [
    { k: "brenner", first: "Thomas", last: "Brenner", email: "t.brenner@brenner-maschinenbau.example.de", phone: "+49 89 1234501", co: "brenner", owner: "vertrieb-a", stage: "sql", tags: ["maschinenbau", "messe-2026"], branche: "Maschinenbau", ok: true },
    { k: "huber", first: "Sabine", last: "Huber", email: "s.huber@huber-logistik.example.de", phone: "+49 8031 223344", co: "huber", owner: "vertrieb-b", stage: "opportunity", tags: ["logistik"], branche: "Logistik", ok: true },
    { k: "seidl", first: "Markus", last: "Seidl", email: "m.seidl@seidl-elektro.example.de", phone: null, co: "seidl", owner: "vertrieb-c", stage: "mql", tags: ["messe-2026"], branche: "Elektrotechnik", ok: false },
    { k: "hofmann", first: "Julia", last: "Hofmann", email: "j.hofmann@alpenblick-hotels.example.com", phone: "+49 8821 5555", co: "alpenblick", owner: "vertrieb-a", stage: "lead", tags: ["hotellerie"], branche: "Hotellerie", ok: true, unsub: true },
    { k: "kraus", first: "Andreas", last: "Kraus", email: "a.kraus@kraus-stb.example.de", phone: null, co: "kraus", owner: null, stage: "subscriber", tags: ["newsletter"], branche: "Steuerberatung", ok: true },
    { k: "weber", first: "Claudia", last: "Weber", email: "c.weber@weber-medtech.example.de", phone: "+49 911 70707", co: "weber", owner: "teamleitung", stage: "customer", tags: ["bestandskunde"], branche: "Medizintechnik", ok: true, nr: "K-10023" },
    { k: "lindner", first: "Stefan", last: "Lindner", email: "s.lindner@lindner-bau.example.de", phone: "+49 941 121212", co: "lindner", owner: "vertrieb-c", stage: "lead", tags: ["bau"], branche: "Bau", ok: false, bounce: true },
    { k: "gruber", first: "Petra", last: "Gruber", email: "p.gruber@gruber-it.example.com", phone: null, co: "gruber", owner: "vertrieb-b", stage: "evangelist", tags: ["bestandskunde", "referenz"], branche: "IT-Service", ok: true, nr: "K-10007" },
    { k: "intern", first: "Interner", last: "Test (intern)", email: internal, phone: null, co: null, owner: "vertrieb-a", stage: "lead", tags: ["e2e-echt", "intern"], branche: null, ok: true },
    { k: "kundin", first: "Kundin", last: "Test (live)", email: customer, phone: null, co: "one", owner: "vertrieb-a", stage: "customer", tags: ["e2e-echt", "bestandskunde"], branche: "IT-Service", ok: true, nr: "K-10099" },
  ] as const;
  const contacts: Record<string, string> = {};
  for (const c of contactSpecs) {
    const extra = c as { unsub?: boolean; bounce?: boolean; nr?: string };
    const created = await db.contact.create({
      data: {
        workspaceId: ws.id, firstName: c.first, lastName: c.last, email: c.email, phone: c.phone,
        company: c.co ? companySpecs.find((s) => s.k === c.co)!.name : null, companyId: c.co ? companies[c.co] : null,
        ownerId: c.owner ? users[c.owner] : null, lifecycleStage: c.stage, tags: [...c.tags],
        source: c.k === "intern" || c.k === "kundin" ? "E2E-Test (echte Testadresse)" : "Messe / Empfehlung (Testdaten)",
        attributes: { ...(c.branche ? { BRANCHE: c.branche } : {}), ...(extra.nr ? { KUNDENNUMMER: extra.nr } : {}) },
        ...(c.ok ? consent(c.k === "intern" || c.k === "kundin" ? "E2E-Test: Einwilligung durch das Testteam" : "DOI (Testdaten)") : {}),
        unsubscribedAt: extra.unsub ? days(-3) : null,
        trustScore: c.k === "lindner" ? 35 : 80,
        createdAt: days(-40 + contactSpecs.indexOf(c) * 3),
      },
    });
    contacts[c.k] = created.id;
    if (extra.bounce) await db.suppression.create({ data: { workspaceId: ws.id, email: c.email, reason: "hard_bounce", source: "E2E-Seed" } });
    if (extra.unsub) await db.suppression.create({ data: { workspaceId: ws.id, email: c.email, reason: "unsubscribed", source: "E2E-Seed" } });
    await db.activity.create({ data: { workspaceId: ws.id, contactId: created.id, type: "NOTE", body: `Erstkontakt: ${c.k === "kundin" ? "Bestandskundin, Testpostfach Microsoft 365" : "Gespräch auf der Fachmesse, Interesse an KI-Schulung"}`, createdAt: days(-20) } });
  }

  // Deals (10) über alle Phasen
  const st = (name: string) => dealPipe.stages.find((s) => s.name === name)!.id;
  const dealSpecs = [
    { title: "KI-Champion-Track 6 Plätze", c: "brenner", co: "brenner", owner: "vertrieb-a", stage: "Angebot", eur: 8940 },
    { title: "Inhouse-Workshop Datenschutz & KI", c: "huber", co: "huber", owner: "vertrieb-b", stage: "Qualifiziert", eur: 3200 },
    { title: "OneLog Lizenz 25 Nutzer", c: "seidl", co: "seidl", owner: "vertrieb-c", stage: "Kontaktiert", eur: 5400 },
    { title: "Hotel-Chatbot Pilot", c: "hofmann", co: "alpenblick", owner: "vertrieb-a", stage: "Neu", eur: 4500 },
    { title: "Mandanten-Portal Steuerkanzlei", c: "kraus", co: "kraus", owner: null, stage: "Neu", eur: 2900 },
    { title: "Rahmenvertrag Schulungen 2027", c: "weber", co: "weber", owner: "teamleitung", stage: "Gewonnen", eur: 24000, closed: -6 },
    { title: "Baustellen-Doku mit KI", c: "lindner", co: "lindner", owner: "vertrieb-c", stage: "Verloren", eur: 6100, closed: -12, lost: "Budget auf 2027 verschoben" },
    { title: "Referenzprojekt Verlängerung", c: "gruber", co: "gruber", owner: "vertrieb-b", stage: "Gewonnen", eur: 3600, closed: -2 },
    { title: "E2E Testkundin: Support-Paket", c: "kundin", co: "one", owner: "vertrieb-a", stage: "Angebot", eur: 1490 },
    { title: "Messe-Nachfass Seidl Service", c: "seidl", co: "seidl", owner: "vertrieb-c", stage: "Qualifiziert", eur: 1800 },
  ] as const;
  const deals: Record<string, string> = {};
  for (const [i, d] of dealSpecs.entries()) {
    const x = d as { closed?: number; lost?: string };
    const deal = await db.deal.create({
      data: {
        workspaceId: ws.id, pipelineId: dealPipe.id, stageId: st(d.stage), title: d.title, valueCents: d.eur * 100,
        contactId: contacts[d.c], companyId: companies[d.co], ownerId: d.owner ? users[d.owner] : null, position: i,
        closedAt: x.closed !== undefined ? days(x.closed) : null, lostReason: x.lost ?? null,
        createdAt: days(-35 + i * 2), updatedAt: d.title.startsWith("Messe") ? days(-20) : days(-1),
      },
    });
    deals[d.title] = deal.id;
  }

  // Tickets (6)
  const tst = (name: string) => ticketPipe.stages.find((s) => s.name === name)!.id;
  const ticketSpecs = [
    { subject: "OneLog-Export bricht mit Fehler 500 ab", prio: "urgent", c: "huber", co: "huber", stage: "Neu", created: -0.3 },
    { subject: "Zugang für neue Mitarbeiterin anlegen", prio: "low", c: "weber", co: "weber", stage: "Wartet auf uns", created: -2 },
    { subject: "Rechnung RE-2026-9001 Rückfrage Leistungszeitraum", prio: "medium", c: "kundin", co: "one", stage: "Wartet auf Kunde", created: -1 },
    { subject: "Schulungsunterlagen als PDF fehlen", prio: "medium", c: "gruber", co: "gruber", stage: "Neu", created: -3 },
    { subject: "Single Sign-on einrichten", prio: "high", c: "brenner", co: "brenner", stage: "Wartet auf uns", created: -1.2 },
    { subject: "Passwort zurücksetzen", prio: "low", c: "kraus", co: "kraus", stage: "Geschlossen", created: -9, closed: -8 },
  ] as const;
  for (const t of ticketSpecs) {
    const created = days(t.created);
    const x = t as { closed?: number };
    await db.ticket.create({
      data: {
        workspaceId: ws.id, pipelineId: ticketPipe.id, stageId: tst(t.stage), subject: t.subject, priority: t.prio,
        description: `Testticket (E2E): ${t.subject}.`, source: t.prio === "urgent" ? "agent" : "email",
        contactId: contacts[t.c], companyId: companies[t.co], ownerId: users.service,
        slaDueAt: new Date(created.getTime() + SLA_HOURS[t.prio] * 36e5), createdAt: created,
        closedAt: x.closed !== undefined ? days(x.closed) : null, firstResponseAt: x.closed !== undefined ? days(t.created + 0.1) : null,
      },
    });
  }

  // Aufgaben (10): überfällig / heute / kommend / erledigt
  const taskSpecs = [
    { title: "Angebot Brenner nachfassen", due: -2, owner: "vertrieb-a", c: "brenner" },
    { title: "Workshop-Termin Huber abstimmen", due: 0, owner: "vertrieb-b", c: "huber" },
    { title: "Lizenzangebot Seidl schreiben", due: 1, owner: "vertrieb-c", c: "seidl" },
    { title: "Chatbot-Demo Alpenblick vorbereiten", due: 3, owner: "vertrieb-a", c: "hofmann" },
    { title: "Kanzlei Kraus qualifizieren", due: -1, owner: null, c: "kraus" },
    { title: "Onboarding Weber: Kick-off planen", due: 2, owner: "teamleitung", c: "weber" },
    { title: "Referenz-Video mit Gruber abstimmen", due: 7, owner: "marketing", c: "gruber" },
    { title: "SSO-Ticket Brenner prüfen", due: 0, owner: "service", c: "brenner" },
    { title: "Rechnung RE-2026-9001 klären", due: 1, owner: "buchhaltung", c: "kundin" },
    { title: "Messe-Leads importieren", due: -5, owner: "marketing", c: null, done: -4 },
  ] as const;
  for (const t of taskSpecs) {
    const x = t as { done?: number };
    await db.task.create({
      data: {
        workspaceId: ws.id, title: t.title, dueAt: days(t.due), ownerId: t.owner ? users[t.owner] : null,
        contactId: t.c ? contacts[t.c] : null, doneAt: x.done !== undefined ? days(x.done) : null,
      },
    });
  }

  // Termine (6)
  const at = (d: number, h: number) => new Date(new Date(now + d * DAY).setHours(h, 0, 0, 0));
  const eventSpecs = [
    { title: "Erstgespräch Brenner (Teams)", d: 1, h: 10, c: "brenner" },
    { title: "Workshop-Vorbesprechung Huber", d: 2, h: 14, c: "huber" },
    { title: "Chatbot-Demo Alpenblick vor Ort", d: 4, h: 9, c: "hofmann" },
    { title: "Kick-off Weber Medizintechnik", d: 6, h: 13, c: "weber" },
    { title: "Quartalsgespräch Gruber", d: 9, h: 11, c: "gruber" },
    { title: "Support-Call Testkundin", d: 3, h: 15, c: "kundin" },
  ] as const;
  for (const e of eventSpecs) {
    await db.event.create({ data: { workspaceId: ws.id, title: e.title, startsAt: at(e.d, e.h), endsAt: at(e.d, e.h + 1), contactId: contacts[e.c], location: "Online" } });
  }

  // Listen (3)
  const listSpecs = [
    { name: "Newsletter Mittelstand", members: ["brenner", "huber", "hofmann", "kraus", "weber", "gruber", "intern", "kundin"] },
    { name: "Messe-Kontakte 2026", members: ["brenner", "seidl", "lindner"] },
    { name: "Bestandskunden", members: ["weber", "gruber", "kundin"] },
  ];
  const lists: Record<string, string> = {};
  for (const l of listSpecs) {
    const list = await db.contactList.create({ data: { workspaceId: ws.id, name: l.name } });
    lists[l.name] = list.id;
    await db.contactListMember.createMany({ data: l.members.map((m) => ({ listId: list.id, contactId: contacts[m] })) });
  }

  // Formular mit DOI-Einwilligung
  const form = await db.form.create({
    data: {
      workspaceId: ws.id, name: "Kontakt & Newsletter",
      fields: [
        { key: "firstName", label: "Vorname", type: "text", required: true },
        { key: "lastName", label: "Nachname", type: "text", required: true },
        { key: "email", label: "E-Mail", type: "email", required: true },
        { key: "company", label: "Unternehmen", type: "text", required: false },
        { key: "message", label: "Ihre Nachricht", type: "textarea", required: false },
      ],
      consentText: "Ja, ich möchte den Newsletter des Testmandanten erhalten (Abmeldung jederzeit möglich).",
    },
  });

  // E-Mail-Vorlagen + Kampagnen-Entwurf
  await db.emailTemplate.create({
    data: { workspaceId: ws.id, name: "Willkommen (Test)", subject: "Willkommen bei {{ params.firma | default: \"uns\" }}", html: "<p>Hallo {{ contact.FIRSTNAME }},</p><p>danke für Ihr Vertrauen. Ihr Ansprechpartner meldet sich in Kürze.</p>", text: "Hallo {{ contact.FIRSTNAME }}, danke für Ihr Vertrauen." },
  });
  await db.emailTemplate.create({
    data: { workspaceId: ws.id, name: "Terminbestätigung (Test)", subject: "Ihr Termin am {{ params.datum }}", html: "<p>Hallo {{ params.name }},</p><p>wir bestätigen Ihren Termin am <b>{{ params.datum }}</b>.</p>" },
  });
  await db.campaign.create({
    data: {
      workspaceId: ws.id, name: "Herbst-Newsletter 2026 (Test)", subject: "KI im Mittelstand: 3 Praxisbeispiele",
      bodyMarkdown: "Drei Praxisbeispiele aus Maschinenbau, Logistik und Hotellerie – und wie Sie in 6 Wochen starten.",
      audience: { listIds: [lists["Newsletter Mittelstand"]] }, status: "DRAFT",
    },
  });

  // Landingpage (veröffentlicht, mit A11y-Bericht)
  const pid = (t: string) => `${t}-${randomBytes(4).toString("hex")}`;
  const pageData = {
    root: { props: { title: "KI-Sprechstunde für den Mittelstand" } },
    content: [
      { type: "Hero", props: { id: pid("Hero"), eyebrow: "Kostenlos · 30 Minuten", heading: "KI-Sprechstunde für den Mittelstand", text: "Wir prüfen gemeinsam, wo KI in Ihrem Betrieb sicher und DSGVO-konform Zeit spart.", buttonLabel: "Termin anfragen", buttonHref: "#kontakt", secondaryLabel: "", secondaryHref: "", align: "left", showLogo: "yes", animation: "subtle" } },
      { type: "Features", props: { id: pid("Features"), heading: "Was Sie bekommen", items: [{ title: "Bestandsaufnahme", text: "Welche Abläufe sich eignen." }, { title: "Datenschutz-Check", text: "Was erlaubt ist und was nicht." }, { title: "Fahrplan", text: "Drei konkrete nächste Schritte." }], animation: "subtle" } },
      { type: "FAQ", props: { id: pid("FAQ"), heading: "Häufige Fragen", items: [{ question: "Was kostet die Sprechstunde?", answer: "Die Sprechstunde ist kostenlos und unverbindlich." }, { question: "Werden meine Daten an US-Anbieter übertragen?", answer: "Nein, wir arbeiten mit Modellen in Deutschland bzw. der EU." }], animation: "none" } },
      { type: "Form", props: { id: pid("Form"), heading: "Termin anfragen", formId: form.id, animation: "none" } },
      { type: "Footer", props: { id: pid("Footer"), note: "Testseite des E2E-Testmandanten." } },
    ],
  };
  const a11y = checkPage(pageData as never, { brandPrimary: ws.brandPrimary, brandAccent: ws.brandAccent, forms: { [form.id]: { fieldCount: 5 } } });
  await db.landingPage.create({
    data: {
      workspaceId: ws.id, slug: "ki-sprechstunde", lang: "de", title: "KI-Sprechstunde für den Mittelstand",
      seoTitle: "KI-Sprechstunde für den Mittelstand – kostenlos", seoDescription: "30 Minuten, DSGVO-konform, mit konkretem Fahrplan.",
      data: pageData, publishedData: pageData, status: "PUBLISHED", publishedAt: days(-5), publishedBy: "E2E-Seed", a11yReport: a11y as unknown as Prisma.InputJsonValue,
    },
  });

  // Wissen (öffentlich + intern) und Wiki
  const sources = [
    { title: "Leistungen und Preise (öffentlich)", isPublic: true, content: "Der KI-Champion-Track dauert 6 Wochen und kostet 1.490 Euro netto pro Person. Inhouse-Workshops kosten ab 3.200 Euro netto pro Tag. Die KI-Sprechstunde ist kostenlos." },
    { title: "Interne Preisuntergrenzen (vertraulich)", isPublic: false, content: "INTERN: Rabatt maximal 15 Prozent, Codewort für Sonderfreigabe ist Bergkristall. Nicht an Kunden weitergeben." },
  ];
  let indexed = 0;
  for (const s of sources) {
    const src = await db.knowledgeSource.create({ data: { workspaceId: ws.id, kind: "text", title: s.title, content: s.content, isPublic: s.isPublic, status: "pending" } });
    try {
      const parts = chunkText(s.content);
      const vecs = await embed(parts);
      for (const [i, p] of parts.entries()) {
        await db.$executeRaw`INSERT INTO "KnowledgeChunk" ("id","workspaceId","sourceId","position","content","embedding","embedModel","createdAt")
          VALUES (${randomBytes(12).toString("hex")}, ${ws.id}, ${src.id}, ${i}, ${p}, ${toVectorLiteral(vecs[i])}::vector, ${process.env.OLLAMA_EMBED_MODEL ?? "qwen3-embedding:0.6b"}, now())`;
      }
      await db.knowledgeSource.update({ where: { id: src.id }, data: { status: "indexed", contentHash: createHash("sha256").update(s.content).digest("hex") } });
      indexed++;
    } catch (e) {
      await db.knowledgeSource.update({ where: { id: src.id }, data: { status: "failed", error: `Seed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` } });
    }
  }
  await db.wikiPage.create({
    data: {
      workspaceId: ws.id, slug: "start", title: "E2E Testmandant – Übersicht",
      body: "# E2E Testmandant\n\nFiktiver Anbieter von KI-Schulungen für den Mittelstand.\n\n## Angebot\n- KI-Champion-Track (6 Wochen)\n- Inhouse-Workshops\n- Kostenlose KI-Sprechstunde\n",
      revisions: { create: { body: "Seed", author: "mensch", note: "E2E-Seed" } },
    },
  });

  // Angebot + Rechnung (Summen positionsgenau, kaufmännisch gerundet)
  const items = [
    { title: "KI-Champion-Track (6 Wochen), je Person", qty: 2, unitCents: 149000, vatRate: 19 },
    { title: "Lernmaterial gedruckt", qty: 2, unitCents: 2500, vatRate: 7 },
  ];
  const net = items.reduce((a, i) => a + i.qty * i.unitCents, 0);
  const vat = items.reduce((a, i) => a + Math.round((i.qty * i.unitCents * i.vatRate) / 100), 0);
  const buyer = { buyerName: "Testkundin GmbH (Test)", buyerAddress: "Testweg 1\n80331 München", buyerEmail: customer, buyerReference: "E2E-REF-0001" };
  const quote = await db.invoice.create({
    data: { workspaceId: ws.id, contactId: contacts.kundin, kind: "QUOTE", number: "AN-2026-9001", status: "ACCEPTED", items, netCents: net, vatCents: vat, grossCents: net + vat, issueDate: days(-10), dueDate: days(20), ...buyer },
  });
  await db.invoice.create({
    data: {
      workspaceId: ws.id, contactId: contacts.kundin, kind: "INVOICE", number: "RE-2026-9001", status: "SENT", items, netCents: net, vatCents: vat, grossCents: net + vat,
      issueDate: days(-3), dueDate: days(11), serviceFrom: days(-45), serviceTo: days(-4), fromQuoteId: quote.id, ...buyer,
    },
  });

  // Analytics (Menschen, KI-Bots, KI-Referrals, Conversions) – ohne IP, ohne Query-Strings
  const page = "/p/e2e/de/ki-sprechstunde";
  const ev: Prisma.AnalyticsEventCreateManyInput[] = [];
  for (let d = 13; d >= 0; d--) {
    const date = new Date(new Date(now - d * DAY).toISOString().slice(0, 10));
    const ts = new Date(now - d * DAY);
    for (let i = 0; i < 3 + (d % 4); i++) ev.push({ workspaceId: ws.id, ts, date, kind: "pageview", path: page, device: i % 3 ? "desktop" : "mobile", lang: "de", visitorHash: randomBytes(16).toString("hex"), referrerHost: i % 2 ? "www.google.com" : null });
    ev.push({ workspaceId: ws.id, ts, date, kind: "bot", path: page, device: "bot", botCategory: "ai_training", botName: "GPTBot" });
    if (d % 2 === 0) ev.push({ workspaceId: ws.id, ts, date, kind: "bot", path: "/p/e2e/llms.txt", device: "bot", botCategory: "ai_training", botName: "ClaudeBot" });
    if (d % 3 === 0) ev.push({ workspaceId: ws.id, ts, date, kind: "bot", path: "/p/e2e/robots.txt", device: "bot", botCategory: "ai_search", botName: "PerplexityBot" });
    if (d % 4 === 0) ev.push({ workspaceId: ws.id, ts, date, kind: "pageview", path: page, device: "desktop", lang: "de", visitorHash: randomBytes(16).toString("hex"), referrerHost: "chatgpt.com", aiReferrer: "chatgpt", utmSource: "chatgpt.com" });
  }
  const today = new Date(new Date(now).toISOString().slice(0, 10));
  ev.push({ workspaceId: ws.id, ts: new Date(now - 2 * DAY), date: new Date(today.getTime() - 2 * DAY), kind: "conversion", name: "form_submit", path: page, contactId: contacts.brenner, aiReferrer: "chatgpt" });
  ev.push({ workspaceId: ws.id, ts: new Date(now - 6 * DAY), date: new Date(today.getTime() - 6 * DAY), kind: "conversion", name: "form_submit", path: page, contactId: contacts.weber, referrerHost: "www.google.com" });
  await db.analyticsEvent.createMany({ data: ev });

  // Kanäle mit Kennzahlen
  const yt = await db.channelAccount.create({ data: { workspaceId: ws.id, platform: "youtube", handle: "@e2e-testmandant", url: "https://www.youtube.com/@e2e-testmandant" } });
  const li = await db.channelAccount.create({ data: { workspaceId: ws.id, platform: "linkedin", handle: "e2e-testmandant", url: "https://www.linkedin.com/company/e2e-testmandant" } });
  for (let w = 4; w >= 0; w--) {
    const date = new Date(new Date(now - w * 7 * DAY).toISOString().slice(0, 10));
    await db.channelMetric.create({ data: { accountId: yt.id, date, followers: 480 + (4 - w) * 22, views: 5200 + (4 - w) * 640, posts: 31 + (4 - w) } });
    await db.channelMetric.create({ data: { accountId: li.id, date, followers: 1210 + (4 - w) * 35, posts: 88 + (4 - w) * 2 } });
  }

  const counts = {
    benutzer: E2E_USERS.length, unternehmen: companySpecs.length, kontakte: contactSpecs.length, deals: dealSpecs.length,
    tickets: ticketSpecs.length, aufgaben: taskSpecs.length, termine: eventSpecs.length, listen: listSpecs.length,
    prozesse: processes.created.length, wissenIndiziert: `${indexed}/${sources.length}`, analyticsEvents: ev.length,
  };
  return { workspaceId: ws.id, counts };
}

async function main() {
  if (process.argv.includes("--reset")) {
    const r = await reset();
    const left = await db.workspace.count({ where: { slug: SLUG } });
    const users = await db.user.count({ where: { email: { endsWith: `@${USER_DOMAIN}` } } });
    console.log(JSON.stringify({ ...r, verbleibend: { workspace: left, benutzer: users } }));
    return;
  }
  const r = await seed();
  console.log(JSON.stringify(r));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

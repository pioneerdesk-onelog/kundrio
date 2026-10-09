// Lastdaten für den Belastungstest (Testplan Feature-Freeze, Block 3).
//
//   LOAD_SEED_CONFIRM=<datenbankname> DATABASE_URL=postgresql://…/<datenbankname> \
//     npx tsx scripts/load-seed.ts [--scale=1] [--embed=ollama|random|none] [--reset]
//
// Sicherheitsregeln:
//  • Läuft NUR, wenn LOAD_SEED_CONFIRM exakt dem Datenbanknamen aus DATABASE_URL entspricht
//    und der Name nicht "crm" ist (normale Entwicklungsdatenbank) – nie versehentlich echte Daten fluten.
//  • Lädt keine .env (DATABASE_URL muss ausdrücklich gesetzt sein).
//  • Alle Sub-Accounts tragen das Präfix "last-", alle E-Mail-Adressen enden auf ".example" (RFC 2606).
//
// Mengen bei --scale=1: 20 Sub-Accounts, 50.000 Kontakte, 10.000 Firmen, 10.000 Deals, 20.000 Aufgaben,
// 100.000 Aktivitäten, 200.000 Analytics-Ereignisse, 5.000 Gespräche (~15.000 Nachrichten), 2.000 Tickets,
// 3.000 Rechnungen, 2.000 Erwähnungen, 20.000 E-Mails, 50.000 verarbeitete Outbox-Ereignisse,
// 5.000 Prozessläufe, 2.000 Wissens-Chunks (Embeddings per Ollama oder Zufallsvektoren), 20 Dateien.
// Hinweis: Zufallswerte in LATERAL-Unterabfragen müssen g referenzieren, sonst wertet Postgres sie nur einmal aus.
// Verteilung bewusst schief: last-01 trägt 40 %, last-02 10 %, der Rest teilt sich 50 %.
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LIFECYCLE, TICKET_STAGES } from "../src/lib/objects/lifecycle";
import { ensureDefaultProcesses } from "../src/lib/process/defaults";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const SCALE = Number(args.scale ?? 1);
const EMBED = (args.embed ?? "ollama") as "ollama" | "random" | "none";
const WS_COUNT = 20;

function guard() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt (wird bewusst nicht aus .env geladen).");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName || dbName === "crm") throw new Error(`Abbruch: Datenbank "${dbName}" ist keine Lastdatenbank.`);
  if (process.env.LOAD_SEED_CONFIRM !== dbName) throw new Error(`Abbruch: LOAD_SEED_CONFIRM=${dbName} setzen, um "${dbName}" zu befüllen.`);
  return dbName;
}

const db = new PrismaClient();
const n = (x: number) => Math.max(1, Math.round(x * SCALE));
/** Anteil je Sub-Account: 40 % / 10 % / Rest gleichmäßig */
function share(total: number, idx: number) {
  if (idx === 0) return Math.round(total * 0.4);
  if (idx === 1) return Math.round(total * 0.1);
  return Math.round((total * 0.5) / (WS_COUNT - 2));
}
const ID = `'l' || replace(gen_random_uuid()::text, '-', '')`;
const STAGES: { name: string; kind: "OPEN" | "WON" | "LOST" }[] = [
  { name: "Neu", kind: "OPEN" },
  { name: "Kontaktiert", kind: "OPEN" },
  { name: "Qualifiziert", kind: "OPEN" },
  { name: "Angebot", kind: "OPEN" },
  { name: "Gewonnen", kind: "WON" },
  { name: "Verloren", kind: "LOST" },
];
const FIRST = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Hannes", "Ida", "Jonas", "Katrin", "Lukas", "Mia", "Noah", "Olga", "Paul", "Rita", "Stefan", "Tina", "Uwe"];
const LAST = ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Neumann", "Schwarz", "Braun", "Zimmermann", "Krüger", "Hartmann"];
const sqlArr = (xs: readonly string[]) => `ARRAY[${xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]`;

async function timed<T>(label: string, fn: () => Promise<T>) {
  const t = Date.now();
  const r = await fn();
  console.log(`  ${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return r;
}

async function reset() {
  const r = await db.workspace.deleteMany({ where: { slug: { startsWith: "last-" } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@last.example" } } });
  console.log(`Zurückgesetzt: ${r.count} Sub-Accounts`);
}

async function workspaces() {
  const agency = (await db.agency.findFirst({ where: { name: "Pioneerdesk GmbH" } })) ?? (await db.agency.create({ data: { name: "Pioneerdesk GmbH" } }));
  const out: { id: string; slug: string; idx: number }[] = [];
  for (let i = 0; i < WS_COUNT; i++) {
    const slug = `last-${String(i + 1).padStart(2, "0")}`;
    const domain = `${slug}.example`;
    const ws = await db.workspace.upsert({
      where: { slug },
      update: {},
      create: { slug, name: `Last ${String(i + 1).padStart(2, "0")}`, domain, agencyId: agency.id, mailFromName: `Last ${i + 1}`, mailFromEmail: `info@${domain}` },
    });
    if ((await db.pipeline.count({ where: { workspaceId: ws.id, objectType: "deal" } })) === 0) {
      await db.pipeline.create({ data: { workspaceId: ws.id, name: "Vertrieb", stages: { create: STAGES.map((s, p) => ({ ...s, position: p })) } } });
    }
    if ((await db.pipeline.count({ where: { workspaceId: ws.id, objectType: "ticket" } })) === 0) {
      await db.pipeline.create({ data: { workspaceId: ws.id, name: "Support", objectType: "ticket", stages: { create: TICKET_STAGES.map((s, p) => ({ ...s, position: p })) } } });
    }
    await db.lifecycleStage.createMany({ data: DEFAULT_LIFECYCLE.map((s, p) => ({ workspaceId: ws.id, key: s.key, label: s.label, position: p })), skipDuplicates: true });
    await db.inbox.upsert({
      where: { workspaceId_kind_address: { workspaceId: ws.id, kind: "email", address: `support@${domain}` } },
      update: {},
      create: { workspaceId: ws.id, name: "Support", kind: "email", address: `support@${domain}`, provider: "imap", active: false },
    });
    await ensureDefaultProcesses(db, ws.id);
    out.push({ id: ws.id, slug, idx: i });
  }
  return out;
}

async function users(wss: { id: string; idx: number }[]) {
  // Zuständige ohne Anmeldung (Passwort-Hash unbrauchbar) – nur für realistische ownerId-Verteilung
  const ids: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const u = await db.user.upsert({
      where: { email: `vertrieb${i}@last.example` },
      update: {},
      create: { email: `vertrieb${i}@last.example`, name: `Vertrieb ${i}`, passwordHash: `disabled:${randomBytes(16).toString("hex")}`, active: true },
    });
    ids.push(u.id);
    for (const ws of wss.filter((w) => w.idx < 3)) {
      await db.membership.upsert({ where: { userId_workspaceId: { userId: u.id, workspaceId: ws.id } }, update: {}, create: { userId: u.id, workspaceId: ws.id } });
    }
  }
  return ids;
}

async function bulk(ws: { id: string; idx: number }, owners: string[]) {
  const w = ws.id;
  const C = share(n(50_000), ws.idx);
  const CO = share(n(10_000), ws.idx);
  const D = share(n(10_000), ws.idx);
  const ownersSql = ws.idx < 3 ? sqlArr(owners) : "ARRAY[]::text[]";
  const lifecycle = sqlArr(DEFAULT_LIFECYCLE.map((s) => s.key).filter((k) => k !== "other"));
  const ex = (sql: string, ...p: unknown[]) => db.$executeRawUnsafe(sql, ...p);

  await ex(`INSERT INTO "Company" (id,"workspaceId",name,domain,industry,size,website,"createdAt","updatedAt")
    SELECT ${ID}, $1, 'Firma ' || g || ' ' || (ARRAY['GmbH','AG','KG','UG','e.K.'])[1 + g % 5], 'firma' || g || '-' || $2 || '.example',
      (ARRAY['IT','Handel','Handwerk','Beratung','Industrie','Gesundheit'])[1 + g % 6], (ARRAY['1-10','11-50','51-200','201-1000'])[1 + g % 4],
      'https://firma' || g || '.example', now() - (random() * interval '700 days'), now() - (random() * interval '30 days')
    FROM generate_series(1, $3::int) g`, w, ws.idx + 1, CO);

  // Hilfstabellen (normale UNLOGGED-Tabellen: Prisma nutzt einen Verbindungspool, TEMP-Tabellen wären je Verbindung)
  await ex(`CREATE UNLOGGED TABLE IF NOT EXISTS _co (rn int PRIMARY KEY, id text)`);
  await ex(`TRUNCATE _co`);
  await ex(`INSERT INTO _co SELECT row_number() OVER (ORDER BY id)::int, id FROM "Company" WHERE "workspaceId" = $1`, w);

  await ex(`INSERT INTO "Contact" (id,"workspaceId","firstName","lastName",email,phone,company,source,tags,"consentEmailAt","consentSource","unsubscribedAt",
      "trustScore","companyId","lifecycleStage","ownerId","createdAt","updatedAt",attributes)
    SELECT ${ID}, $1, f.fn, f.ln, lower(f.fn) || '.' || g || '@kunde' || (g % 997) || '.example', '+4930' || (1000000 + g),
      co.name, (ARRAY['formular','import','agent','manuell','api'])[1 + g % 5],
      CASE WHEN g % 3 = 0 THEN ARRAY['newsletter'] WHEN g % 7 = 0 THEN ARRAY['messe','vip'] ELSE ARRAY[]::text[] END,
      CASE WHEN g % 5 < 3 THEN now() - (random() * interval '600 days') END, CASE WHEN g % 5 < 3 THEN 'doi' END,
      CASE WHEN g % 50 = 0 THEN now() - (random() * interval '30 days') END,
      (random() * 100)::int, CASE WHEN g % 10 < 7 THEN c.id END, (${lifecycle})[1 + g % 7],
      CASE WHEN cardinality(${ownersSql}) > 0 AND g % 4 <> 0 THEN (${ownersSql})[1 + g % 8] END,
      now() - (random() * interval '700 days'), now() - (random() * interval '60 days'), '{}'::jsonb
    FROM generate_series(1, $2::int) g
    CROSS JOIN LATERAL (SELECT (${sqlArr(FIRST)})[1 + g % 20] fn, (${sqlArr(LAST)})[1 + (g / 20) % 20] ln) f
    LEFT JOIN _co c ON c.rn = 1 + g % $3::int
    LEFT JOIN "Company" co ON co.id = c.id`, w, C, CO);

  await ex(`CREATE UNLOGGED TABLE IF NOT EXISTS _ct (rn int PRIMARY KEY, id text)`);
  await ex(`TRUNCATE _ct`);
  await ex(`INSERT INTO _ct SELECT row_number() OVER (ORDER BY id)::int, id FROM "Contact" WHERE "workspaceId" = $1`, w);
  await ex(`ANALYZE _ct`);
  await ex(`ANALYZE _co`);

  // Deals: Phase zufällig, gewonnen/verloren mit Abschlussdatum
  await ex(`INSERT INTO "Deal" (id,"workspaceId","pipelineId","stageId","contactId","companyId",title,"valueCents",position,"closedAt","ownerId","createdAt","updatedAt",attributes)
    SELECT ${ID}, $1, s."pipelineId", s.id, ct.id, (SELECT "companyId" FROM "Contact" WHERE id = ct.id), 'Deal ' || g, (500 + random() * 50000)::int * 100, g,
      CASE WHEN s.kind IN ('WON','LOST') THEN now() - (random() * interval '200 days') END,
      CASE WHEN cardinality(${ownersSql}) > 0 THEN (${ownersSql})[1 + g % 8] END,
      now() - (random() * interval '400 days'), now() - (random() * interval '30 days'), '{}'::jsonb
    FROM generate_series(1, $2::int) g
    JOIN LATERAL (SELECT st.id, st."pipelineId", st.kind FROM "Stage" st JOIN "Pipeline" p ON p.id = st."pipelineId"
                  WHERE p."workspaceId" = $1 AND p."objectType" = 'deal' ORDER BY st.position OFFSET g % 6 LIMIT 1) s ON true
    JOIN _ct ct ON ct.rn = 1 + (g * 7) % $3::int`, w, D, C);

  await ex(`INSERT INTO "Task" (id,"workspaceId",title,"dueAt","doneAt","contactId","ownerId","createdAt")
    SELECT ${ID}, $1, 'Rückruf ' || g, now() + ((g % 60) - 30) * interval '1 day', CASE WHEN g % 2 = 0 THEN now() - (random() * interval '30 days') END,
      ct.id, CASE WHEN cardinality(${ownersSql}) > 0 THEN (${ownersSql})[1 + g % 8] END, now() - (random() * interval '90 days')
    FROM generate_series(1, $2::int) g JOIN _ct ct ON ct.rn = 1 + (g * 13) % $3::int`, w, share(n(20_000), ws.idx), C);

  await ex(`INSERT INTO "Activity" (id,"workspaceId","contactId",type,body,"createdAt")
    SELECT ${ID}, $1, ct.id, (ARRAY['NOTE','EMAIL_OUT','EMAIL_IN','FORM','SYSTEM'])[1 + g % 5]::"ActivityType", 'Aktivität ' || g, now() - (random() * interval '365 days')
    FROM generate_series(1, $2::int) g JOIN _ct ct ON ct.rn = 1 + (g * 3) % $3::int`, w, share(n(100_000), ws.idx), C);

  // Analytics: ohne IP, ohne Query-String, tagesrotierender Hash
  await ex(`INSERT INTO "AnalyticsEvent" ("workspaceId",ts,date,kind,name,host,path,"referrerHost","utmSource",device,lang,"visitorHash","botCategory","botName","aiReferrer")
    SELECT $1, t, t::date, k.kind, CASE WHEN k.kind IN ('event','conversion') THEN (ARRAY['cta_click','form_submit','download'])[1 + g % 3] END,
      'last.example', (ARRAY['/','/preise','/blog/a','/blog/b','/kontakt','/produkt','/impressum','/ueber-uns'])[1 + g % 8],
      (ARRAY[NULL,'google.com','linkedin.com','chatgpt.com','bing.com'])[1 + g % 5], CASE WHEN g % 9 = 0 THEN 'newsletter' END,
      CASE WHEN k.kind = 'bot' THEN 'bot' ELSE (ARRAY['desktop','mobile','tablet'])[1 + g % 3] END, 'de',
      CASE WHEN k.kind <> 'bot' THEN md5('v' || (g % 5000) || t::date) END,
      CASE WHEN k.kind = 'bot' THEN (ARRAY['search','ai_training','ai_search','seo'])[1 + g % 4] END,
      CASE WHEN k.kind = 'bot' THEN (ARRAY['Googlebot','GPTBot','PerplexityBot','AhrefsBot'])[1 + g % 4] END,
      CASE WHEN k.kind = 'pageview' AND g % 40 = 0 THEN 'chatgpt' END
    FROM generate_series(1, $2::int) g
    CROSS JOIN LATERAL (SELECT now() - ((random() + 0 * g) * interval '120 days') t) tt
    CROSS JOIN LATERAL (SELECT CASE WHEN g % 100 < 75 THEN 'pageview' WHEN g % 100 < 90 THEN 'bot' WHEN g % 100 < 97 THEN 'event' ELSE 'conversion' END kind) k`,
    w, share(n(200_000), ws.idx));

  // Posteingang: Gespräche mit 1–5 Nachrichten
  const inbox = await db.inbox.findFirstOrThrow({ where: { workspaceId: w, kind: "email" } });
  await ex(`INSERT INTO "Conversation" (id,"workspaceId","inboxId","contactId",subject,status,"threadKey","lastMessageAt",unread,priority,"createdAt","updatedAt")
    SELECT ${ID}, $1, $2, ct.id, 'Anfrage ' || g, (ARRAY['open','open','pending','closed','closed'])[1 + g % 5], 'thread-' || g || '@last.example',
      now() - (random() * interval '120 days'), CASE WHEN g % 4 = 0 THEN 1 ELSE 0 END, 'normal', now() - (random() * interval '200 days'), now()
    FROM generate_series(1, $3::int) g JOIN _ct ct ON ct.rn = 1 + (g * 17) % $4::int`, w, inbox.id, share(n(5_000), ws.idx), C);
  await ex(`INSERT INTO "Message" (id,"workspaceId","conversationId",direction,channel,"fromAddr","toAddrs",subject,"bodyText","externalId",status,"createdAt")
    SELECT ${ID}, $1, c.id, CASE WHEN m % 2 = 1 THEN 'in' ELSE 'out' END, 'email', CASE WHEN m % 2 = 1 THEN 'kunde@kunde.example' ELSE 'support@last.example' END,
      ARRAY['support@last.example'], c.subject, 'Hallo, das ist Nachricht ' || m || ' im Gespräch. ' || repeat('Text ', 40), '<' || c.id || '.' || m || '@last.example>',
      CASE WHEN m % 2 = 1 THEN 'received' ELSE 'sent' END, c."lastMessageAt" - (5 - m) * interval '1 hour'
    FROM "Conversation" c CROSS JOIN LATERAL generate_series(1, 1 + abs(hashtext(c.id)) % 5) m WHERE c."workspaceId" = $1`, w);

  const tp = await db.pipeline.findFirstOrThrow({ where: { workspaceId: w, objectType: "ticket" }, include: { stages: { orderBy: { position: "asc" } } } });
  const closed = tp.stages.find((s) => s.kind === "CLOSED")?.id ?? null;
  await ex(`INSERT INTO "Ticket" (id,"workspaceId","pipelineId","stageId",subject,priority,source,"contactId","closedAt","createdAt","updatedAt",attributes)
    SELECT ${ID}, $1, $2, st, 'Ticket ' || g, (ARRAY['low','medium','high','urgent'])[1 + g % 4], 'email', ct.id,
      CASE WHEN st = $5::text THEN now() - (random() * interval '30 days') END, now() - (random() * interval '200 days'), now(), '{}'::jsonb
    FROM generate_series(1, $3::int) g JOIN _ct ct ON ct.rn = 1 + (g * 11) % $4::int
    CROSS JOIN LATERAL (SELECT ($6::text[])[1 + g % cardinality($6::text[])] st) s`,
    w, tp.id, share(n(2_000), ws.idx), C, closed, tp.stages.map((s) => s.id));

  // Rechnungen: Summen konsistent zu den Positionen (Konsistenzprüfung)
  await ex(`INSERT INTO "Invoice" (id,"workspaceId","contactId",kind,number,status,"issueDate","dueDate",items,"netCents","vatCents","grossCents","buyerName","createdAt","updatedAt")
    SELECT ${ID}, $1, ct.id, 'INVOICE', 'RE-L-' || lpad(g::text, 6, '0'), (ARRAY['DRAFT','SENT','PAID','PAID','CANCELLED'])[1 + g % 5],
      (now() - (g % 300) * interval '1 day')::date, (now() - (g % 300) * interval '1 day' + interval '14 days')::date,
      jsonb_build_array(jsonb_build_object('title','Leistung','qty',q,'unitCents',u,'vatRate',19)), q * u, round(q * u * 0.19)::int, q * u + round(q * u * 0.19)::int,
      'Kunde ' || g, now() - (g % 300) * interval '1 day', now()
    FROM generate_series(1, $2::int) g JOIN _ct ct ON ct.rn = 1 + (g * 19) % $3::int
    CROSS JOIN LATERAL (SELECT 1 + g % 5 q, (100 + g % 900) * 100 u) x`, w, share(n(3_000), ws.idx), C);

  await ex(`INSERT INTO "Mention" (id,"workspaceId","companyId",url,title,"sourceHost","sourceKind",language,"publishedAt",snippet,sentiment,relevance,status,"createdAt")
    SELECT ${ID}, $1, c.id, 'https://presse.example/artikel-' || g, 'Artikel ' || g, 'presse.example', (ARRAY['gdelt','searxng','rss'])[1 + g % 3], 'de',
      now() - (random() * interval '200 days'), 'Kurzer Ausschnitt aus dem Artikel ' || g, (ARRAY['positiv','neutral','negativ'])[1 + g % 3], random(),
      (ARRAY['new','relevant','irrelevant'])[1 + g % 3], now() - (random() * interval '200 days')
    FROM generate_series(1, $2::int) g JOIN _co c ON c.rn = 1 + g % $3::int`, w, share(n(2_000), ws.idx), CO);

  await ex(`INSERT INTO "EmailMessage" (id,"workspaceId","contactId",direction,"fromAddr","toAddr",subject,"bodyText","messageId",status,kind,"sentAt","createdAt")
    SELECT ${ID}, $1, ct.id, 'OUT', 'info@last.example', 'kunde' || g || '@kunde.example', 'Newsletter ' || (g % 12), 'Text', '<l' || g || '.' || $1 || '@last.example>',
      (ARRAY['captured','sent','delivered','soft_bounce'])[1 + g % 4], (ARRAY['campaign','one_to_one','transactional'])[1 + g % 3], t, t
    FROM generate_series(1, $2::int) g JOIN _ct ct ON ct.rn = 1 + (g * 23) % $3::int CROSS JOIN LATERAL (SELECT now() - ((random() + 0 * g) * interval '300 days') t) tt`,
    w, share(n(20_000), ws.idx), C);

  // Verarbeitete Outbox-Historie (füllt den Index processedAt,id realistisch)
  await ex(`INSERT INTO "CrmEvent" ("workspaceId",type,"objectType","objectId",data,"createdAt","processedAt")
    SELECT $1, 'contact.property_changed', 'contact', ct.id, '{"field":"phone","import":true}'::jsonb, t, t + interval '1 second'
    FROM generate_series(1, $2::int) g JOIN _ct ct ON ct.rn = 1 + (g * 29) % $3::int CROSS JOIN LATERAL (SELECT now() - ((random() + 0 * g) * interval '90 days') t) tt`,
    w, share(n(50_000), ws.idx), C);

  // Abgeschlossene Prozessläufe eines Standardprozesses (mit Schrittprotokoll)
  const proc = await db.process.findFirst({ where: { workspaceId: w, status: "ACTIVE", objectType: "contact" }, select: { id: true, activeVersionId: true } });
  if (proc?.activeVersionId) {
    await ex(`INSERT INTO "ProcessRun" (id,"workspaceId","processId","versionId","objectType","objectId",status,"dedupeKey",context,"startedAt","updatedAt","finishedAt")
      SELECT ${ID}, $1, $2, $3, 'contact', ct.id, 'done', $2 || ':' || ct.id || ':last' || g, '{}'::jsonb, t, t, t + interval '2 seconds'
      FROM generate_series(1, $4::int) g JOIN _ct ct ON ct.rn = 1 + (g * 31) % $5::int CROSS JOIN LATERAL (SELECT now() - ((random() + 0 * g) * interval '90 days') t) tt`,
      w, proc.id, proc.activeVersionId, share(n(5_000), ws.idx), C);
    await ex(`INSERT INTO "ProcessStepLog" (id,"runId","nodeId","nodeType",status,detail,ms,"createdAt")
      SELECT ${ID}, r.id, 'n' || s, 'logic.if', 'branch', '{"_output":"yes"}'::jsonb, 3, r."startedAt" + s * interval '1 millisecond'
      FROM "ProcessRun" r CROSS JOIN generate_series(1, 2) s WHERE r."workspaceId" = $1 AND r."dedupeKey" LIKE '%:last%'`, w);
  }
}

/** Wissens-Chunks: realistische Teilmenge mit echten (Ollama) oder Zufalls-Embeddings */
async function knowledge(wss: { id: string; idx: number }[]) {
  if (EMBED === "none") return { chunks: 0, mode: "none" };
  const total = n(2_000);
  const targets = wss.filter((w) => w.idx < 5);
  const base = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_EMBED_MODEL ?? "qwen3-embedding:0.6b";
  let mode = EMBED;
  const topics = ["Preise und Tarife", "Datenschutz und DSGVO", "Kündigung und Laufzeit", "Einrichtung und Onboarding", "Support-Zeiten", "Schnittstellen und API", "Rechnungen und Zahlung", "Sicherheit und Hosting in Deutschland"];
  let done = 0;
  for (const [ti, ws] of targets.entries()) {
    const per = Math.round(total / targets.length);
    const src = await db.knowledgeSource.create({ data: { workspaceId: ws.id, kind: "text", title: `Handbuch ${ti + 1}`, status: "indexed", isPublic: ti === 0 } });
    for (let off = 0; off < per; off += 32) {
      const texts = Array.from({ length: Math.min(32, per - off) }, (_, k) => {
        const i = off + k;
        const t = topics[i % topics.length];
        return `${t} (Abschnitt ${i + 1}): Für Kunden von Sub-Account ${ws.idx + 1} gilt Regel ${i % 17}. ${t} wird im Handbuch ausführlich beschrieben; Ansprechpartner ist das Team ${i % 5}. Fristen betragen ${7 + (i % 23)} Tage.`;
      });
      let vecs: number[][] | null = null;
      if (mode === "ollama") {
        try {
          const r = await fetch(`${base}/api/embed`, { method: "POST", body: JSON.stringify({ model, input: texts }), signal: AbortSignal.timeout(120_000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          vecs = ((await r.json()) as { embeddings: number[][] }).embeddings;
          if (vecs[0]?.length !== 1024) throw new Error(`Dimension ${vecs[0]?.length}`);
        } catch (e) {
          console.warn(`  Ollama nicht nutzbar (${e instanceof Error ? e.message : e}) → Zufallsvektoren`);
          mode = "random";
        }
      }
      vecs ??= texts.map(() => {
        const v = Array.from({ length: 1024 }, () => Math.random() - 0.5);
        const len = Math.hypot(...v);
        return v.map((x) => x / len);
      });
      for (let k = 0; k < texts.length; k++) {
        await db.$executeRaw`INSERT INTO "KnowledgeChunk" (id,"workspaceId","sourceId",position,content,embedding,"embedModel","createdAt")
          VALUES (${"l" + randomBytes(12).toString("hex")}, ${ws.id}, ${src.id}, ${off + k}, ${texts[k]}, ${`[${vecs[k].join(",")}]`}::vector, ${mode === "ollama" ? model : `${model}`}, now())`;
      }
      done += texts.length;
    }
  }
  return { chunks: done, mode };
}

/** Kleine Dateien im lokalen Dateispeicher (FILE_STORAGE_DIR) + StoredFile-Zeilen, für die Backup-Stichprobe */
async function files(wss: { id: string; idx: number }[]) {
  const root = process.env.FILE_STORAGE_DIR;
  if (!root) return 0;
  let c = 0;
  for (const ws of wss.slice(0, 5)) {
    for (let i = 0; i < 4; i++) {
      const data = Buffer.from(`Lastdatei ${ws.idx + 1}/${i + 1}\n${randomBytes(256).toString("base64")}\n`);
      const key = `${ws.id}/2026/${randomBytes(12).toString("hex")}.txt`;
      await mkdir(path.dirname(path.join(root, key)), { recursive: true });
      await writeFile(path.join(root, key), data, { mode: 0o600 });
      await db.storedFile.create({ data: { workspaceId: ws.id, kind: "document", name: `lastdatei-${i + 1}.txt`, mime: "text/plain", size: data.length, sha256: createHash("sha256").update(data).digest("hex"), storageKey: key, createdBy: "load-seed" } });
      c++;
    }
  }
  return c;
}

async function main() {
  const dbName = guard();
  console.log(`Lastdaten → Datenbank "${dbName}", Faktor ${SCALE}, Embeddings: ${EMBED}`);
  const t0 = Date.now();
  if (args.reset) await reset();
  if (await db.contact.count({ where: { workspace: { slug: { startsWith: "last-" } } } })) {
    throw new Error("Lastdaten sind bereits vorhanden – mit --reset neu erzeugen.");
  }
  const wss = await timed("Sub-Accounts, Pipelines, Prozesse", workspaces);
  const owners = await timed("Benutzer", () => users(wss));
  for (const ws of wss) await timed(`Massendaten ${ws.slug}`, () => bulk(ws, owners));
  await db.$executeRawUnsafe("DROP TABLE IF EXISTS _co");
  await db.$executeRawUnsafe("DROP TABLE IF EXISTS _ct");
  const k = await timed("Wissens-Chunks", () => knowledge(wss));
  const f = await timed("Dateien", () => files(wss));
  await timed("ANALYZE", () => db.$executeRawUnsafe("ANALYZE"));
  const counts = await db.$queryRawUnsafe<Record<string, bigint>[]>(`SELECT
    (SELECT count(*) FROM "Workspace") ws, (SELECT count(*) FROM "Contact") contacts, (SELECT count(*) FROM "Company") companies,
    (SELECT count(*) FROM "Deal") deals, (SELECT count(*) FROM "Task") tasks, (SELECT count(*) FROM "Activity") activities,
    (SELECT count(*) FROM "AnalyticsEvent") analytics, (SELECT count(*) FROM "Conversation") conversations, (SELECT count(*) FROM "Message") messages,
    (SELECT count(*) FROM "Ticket") tickets, (SELECT count(*) FROM "Invoice") invoices, (SELECT count(*) FROM "Mention") mentions,
    (SELECT count(*) FROM "EmailMessage") emails, (SELECT count(*) FROM "CrmEvent") events, (SELECT count(*) FROM "Process") processes,
    (SELECT count(*) FROM "ProcessRun") runs, (SELECT count(*) FROM "KnowledgeChunk") chunks, (SELECT count(*) FROM "StoredFile") files`);
  console.log(Object.fromEntries(Object.entries(counts[0]).map(([a, b]) => [a, Number(b)])));
  console.log(`Embeddings: ${k.mode} (${k.chunks} Chunks), Dateien: ${f}. Gesamt ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

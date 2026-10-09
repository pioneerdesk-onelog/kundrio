import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { allocateCosts, parseRates, type CostBreakdown, type CostInput, type CostRates } from "./usage-cost";

// Nutzungsmessung je Sub-Account. Wenige gebündelte Abfragen (UNION ALL / groupBy), keine N+1.
// Speicher ist eine Schätzung: Summe pg_column_size der Zeilen + Index-Zuschlag.

/** Tabellen mit direkter workspaceId. Feste Namen (kein Nutzer-Input) → sicher im SQL. */
const DIRECT_TABLES = [
  "Contact", "Activity", "Pipeline", "Deal", "Task", "Event", "Form", "Campaign", "EmailMessage",
  "KnowledgeSource", "WikiPage", "ChannelAccount", "LandingPage", "AnalyticsEvent", "Automation",
  "ComplianceItem", "Invoice", "AiUsageLog", "ApiKey", "EmailTemplate", "EmailEvent", "Suppression",
  "Webhook", "ContactList", "PropertyDefinition", "UsageSnapshot",
] as const;

/** Untertabellen ohne workspaceId → über die Elterntabelle zugeordnet. */
const CHILD_TABLES = [
  { table: "FormSubmission", parent: "Form", fk: "formId" },
  { table: "WikiRevision", parent: "WikiPage", fk: "pageId" },
  { table: "CampaignRecipient", parent: "Campaign", fk: "campaignId" },
  { table: "AutomationRun", parent: "Automation", fk: "automationId" },
  { table: "ChannelMetric", parent: "ChannelAccount", fk: "accountId" },
  { table: "Stage", parent: "Pipeline", fk: "pipelineId" },
  { table: "ContactListMember", parent: "ContactList", fk: "listId" },
] as const;

/** Zuschlag für Indizes/Verwaltung (Schätzwerte). HNSW speichert Vektoren zusätzlich im Index. */
const ROW_INDEX_FACTOR = 1.3;
const VECTOR_INDEX_FACTOR = 2.0;

export const FLOW_DAYS = 30;

export type WorkspaceUsage = {
  workspaceId: string;
  slug: string;
  name: string;
  rows: Record<string, number>;
  storage: { tableBytes: number; embeddingBytes: number; dbBytes: number; objectBytes: number };
  emails30d: { transactional: number; campaign: number; one_to_one: number; system: number; total: number };
  ai30d: { calls: number; tokensIn: number; tokensOut: number; ms: number; byPurpose: Record<string, { calls: number; tokensIn: number; tokensOut: number; ms: number }> };
  analyticsEvents30d: number;
  jobs30d: { total: number; byType: Record<string, number> };
  users: number;
};

const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v ?? 0)) || 0;

export async function measureAll(): Promise<{ measuredAt: Date; workspaces: WorkspaceUsage[]; unassignedAi: WorkspaceUsage["ai30d"] }> {
  const since = new Date(Date.now() - FLOW_DAYS * 24 * 3600 * 1000);
  const workspaces = await db.workspace.findMany({ select: { id: true, slug: true, name: true, logoSvg: true }, orderBy: { name: "asc" } });

  // 1) Zeilen + Bytes je Tabelle und Workspace (eine Abfrage)
  const parts = [
    ...DIRECT_TABLES.map(
      (t) => `SELECT '${t}' AS tbl, t."workspaceId" AS ws, count(*) AS n, coalesce(sum(pg_column_size(t.*)), 0) AS bytes FROM "${t}" t GROUP BY t."workspaceId"`,
    ),
    // Wissens-Chunks: Text getrennt vom Vektor messen
    `SELECT 'KnowledgeChunk' AS tbl, c."workspaceId" AS ws, count(*) AS n,
       coalesce(sum(pg_column_size(c.content) + pg_column_size(c.id) + pg_column_size(c."sourceId") + 64), 0) AS bytes
     FROM "KnowledgeChunk" c GROUP BY c."workspaceId"`,
    ...CHILD_TABLES.map(
      (c) => `SELECT '${c.table}' AS tbl, p."workspaceId" AS ws, count(*) AS n, coalesce(sum(pg_column_size(t.*)), 0) AS bytes FROM "${c.table}" t JOIN "${c.parent}" p ON p.id = t."${c.fk}" GROUP BY p."workspaceId"`,
    ),
  ];
  const rowStats = await db.$queryRawUnsafe<{ tbl: string; ws: string | null; n: bigint; bytes: bigint }[]>(parts.join("\nUNION ALL\n"));

  const chunkCounts = await db.knowledgeChunk.groupBy({ by: ["workspaceId"], _count: true });

  // 2) E-Mails der letzten 30 Tage nach Art (Kampagnen-Mails tragen campaignId)
  const mailRows = await db.$queryRaw<{ ws: string; kind: string; n: bigint }[]>`
    SELECT "workspaceId" AS ws, CASE WHEN "campaignId" IS NOT NULL THEN 'campaign' ELSE kind END AS kind, count(*) AS n
    FROM "EmailMessage" WHERE direction = 'OUT' AND "createdAt" >= ${since}
    GROUP BY 1, 2`;

  // 3) KI-Nutzung je Zweck
  const aiRows = await db.aiUsageLog.groupBy({
    by: ["workspaceId", "purpose"],
    where: { createdAt: { gte: since } },
    _count: true,
    _sum: { tokensIn: true, tokensOut: true, ms: true },
  });

  // 4) Analytics-Ereignisse
  const evRows = await db.analyticsEvent.groupBy({ by: ["workspaceId"], where: { ts: { gte: since } }, _count: true });

  // 5) Jobs (workspaceId steckt – falls vorhanden – im Payload)
  const jobRows = await db.$queryRaw<{ ws: string | null; type: string; n: bigint; ms: bigint | null }[]>`
    SELECT payload->>'workspaceId' AS ws, type, count(*) AS n, sum("durationMs") AS ms FROM "Job" WHERE "createdAt" >= ${since} GROUP BY 1, 2`;

  // 6) Benutzer mit Zugriff: Mitglieder + Agentur-Admins (sehen alle Sub-Accounts)
  const [memberRows, agencyAdmins] = await Promise.all([
    db.membership.groupBy({ by: ["workspaceId"], _count: true }),
    db.user.count({ where: { isAgencyAdmin: true } }),
  ]);

  const emptyAi = () => ({ calls: 0, tokensIn: 0, tokensOut: 0, ms: 0, byPurpose: {} as WorkspaceUsage["ai30d"]["byPurpose"] });
  const unassignedAi = emptyAi();

  const result: WorkspaceUsage[] = workspaces.map((w) => {
    const rows: Record<string, number> = {};
    let tableBytes = 0;
    for (const r of rowStats) {
      if (r.ws !== w.id) continue;
      rows[r.tbl] = (rows[r.tbl] ?? 0) + num(r.n);
      tableBytes += num(r.bytes);
    }
    const chunks = chunkCounts.find((c) => c.workspaceId === w.id)?._count ?? 0;
    const embeddingBytes = chunks * (env.embedDim() * 4 + 8) * VECTOR_INDEX_FACTOR;
    const dbBytes = Math.round(tableBytes * ROW_INDEX_FACTOR + embeddingBytes);
    const objectBytes = w.logoSvg ? Buffer.byteLength(w.logoSvg, "utf8") : 0;

    const emails = { transactional: 0, campaign: 0, one_to_one: 0, system: 0, total: 0 };
    for (const m of mailRows) {
      if (m.ws !== w.id) continue;
      const k = (m.kind in emails ? m.kind : "one_to_one") as keyof typeof emails;
      emails[k] += num(m.n);
      emails.total += num(m.n);
    }

    const ai = emptyAi();
    for (const a of aiRows) {
      if (a.workspaceId !== w.id) continue;
      const p = (ai.byPurpose[a.purpose] ??= { calls: 0, tokensIn: 0, tokensOut: 0, ms: 0 });
      p.calls += a._count;
      p.tokensIn += a._sum.tokensIn ?? 0;
      p.tokensOut += a._sum.tokensOut ?? 0;
      p.ms += a._sum.ms ?? 0;
      ai.calls += a._count;
      ai.tokensIn += a._sum.tokensIn ?? 0;
      ai.tokensOut += a._sum.tokensOut ?? 0;
      ai.ms += a._sum.ms ?? 0;
    }

    // Worker-Rechenzeit (Summe der Laufzeiten) zusätzlich zur Anzahl
    const jobs = { total: 0, ms: 0, byType: {} as Record<string, number> };
    for (const j of jobRows) {
      if (j.ws !== w.id) continue;
      jobs.byType[j.type] = (jobs.byType[j.type] ?? 0) + num(j.n);
      jobs.total += num(j.n);
      jobs.ms += num(j.ms);
    }

    const members = memberRows.find((m) => m.workspaceId === w.id)?._count ?? 0;
    return {
      workspaceId: w.id,
      slug: w.slug,
      name: w.name,
      rows: { ...rows, KnowledgeChunk: rows.KnowledgeChunk ?? chunks },
      storage: { tableBytes, embeddingBytes: Math.round(embeddingBytes), dbBytes, objectBytes },
      emails30d: emails,
      ai30d: ai,
      analyticsEvents30d: evRows.find((e) => e.workspaceId === w.id)?._count ?? 0,
      jobs30d: jobs,
      users: members + agencyAdmins,
    };
  });

  for (const a of aiRows) {
    if (a.workspaceId) continue;
    unassignedAi.calls += a._count;
    unassignedAi.tokensIn += a._sum.tokensIn ?? 0;
    unassignedAi.tokensOut += a._sum.tokensOut ?? 0;
    unassignedAi.ms += a._sum.ms ?? 0;
  }

  return { measuredAt: new Date(), workspaces: result, unassignedAi };
}

export function toCostInput(u: WorkspaceUsage): CostInput {
  return {
    dbBytes: u.storage.dbBytes,
    objectBytes: u.storage.objectBytes,
    emails30d: u.emails30d.total,
    tokensIn30d: u.ai30d.tokensIn,
    tokensOut30d: u.ai30d.tokensOut,
    users: u.users,
  };
}

export async function loadRates(): Promise<CostRates> {
  const s = await db.appSetting.findUnique({ where: { key: "costRates" } });
  return parseRates(s?.value);
}

export async function saveRates(r: CostRates) {
  const value = r as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: "costRates" }, create: { key: "costRates", value }, update: { value } });
}

export function costsFor(usage: WorkspaceUsage[], rates: CostRates): Record<string, CostBreakdown> {
  return allocateCosts(usage.map((u) => ({ key: u.workspaceId, input: toCostInput(u) })), rates);
}

/** Heutige Messung speichern (idempotent: ein Snapshot je Tag und Sub-Account). */
export async function writeSnapshots() {
  const [{ workspaces }, rates] = await Promise.all([measureAll(), loadRates()]);
  const costs = costsFor(workspaces, rates);
  const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  for (const u of workspaces) {
    const metrics = { ...u, cost: costs[u.workspaceId] } as unknown as Prisma.InputJsonValue;
    await db.usageSnapshot.upsert({
      where: { workspaceId_date: { workspaceId: u.workspaceId, date } },
      create: { workspaceId: u.workspaceId, date, metrics, estCostCents: costs[u.workspaceId].totalCents },
      update: { metrics, estCostCents: costs[u.workspaceId].totalCents },
    });
  }
  return workspaces.length;
}

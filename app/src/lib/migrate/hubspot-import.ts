import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { enqueue } from "../jobs";
import { emitEvent } from "../events";
import { ensureObjectDefaults } from "../objects/defaults";
import { DEFAULT_LIFECYCLE, isBackward } from "../objects/lifecycle";
import { normalizeDomain } from "../objects/domain";
import { hsGet, HubspotAuthError, type HsObject, type HsOwner, type HsPage, type HsPipeline, type HsProperty } from "./hubspot-client";
import {
  assocIds, centsFromAmount, companyAddress, COMPANY_STD, CONTACT_STD, customValues, DEAL_STD, dealStageKind, hasConsentBasis,
  isTrue, mapLifecycle, mapPriority, mapPropertyType, stripHtml, TICKET_STD, ticketStageKind,
} from "./hubspot-map";
import { open, seal } from "./secretbox";

// HubSpot → CRM in Etappen (eine Seite = ein Job). Idempotent über externalRef = "hubspot:<id>".
// Reihenfolge: Zuständige → Eigenschaften → Pipelines → Unternehmen → Kontakte → Deals → Tickets → Notizen.

export const HS_PHASES = ["owners", "properties", "pipelines", "companies", "contacts", "deals", "tickets", "notes", "done"] as const;
export type HsPhase = (typeof HS_PHASES)[number];

type CustomProp = { name: string; type: string };
type Obj = "contact" | "company" | "deal" | "ticket";

export type HsProgress = {
  runId: string;
  status: "running" | "done" | "failed" | "cancelled";
  phase: HsPhase;
  counts: Record<"owners" | "properties" | "pipelines" | "companies" | "contacts" | "deals" | "tickets" | "notes" | "created" | "updated" | "skipped" | "suppressed", number>;
  ownerMap: Record<string, string | null>;
  stageMap: Record<string, string>;
  pipelineMap: Record<string, string>;
  customProps: Record<Obj, CustomProp[]>;
  errors: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  startedBy?: string;
};

export type HsStepPayload = { workspaceId: string; runId: string; phase: HsPhase; after?: string | null; key?: string | null; stepId: string };

const settingKey = (workspaceId: string) => `migrate:hubspot:${workspaceId}`;
const ref = (id: string | number) => `hubspot:${id}`;
const PAGE = 100;
const TAG = "import-hubspot";
const SOURCE = "import:hubspot";
const MAX_CUSTOM = 60;
const HS_OBJECT: Record<Obj, string> = { contact: "contacts", company: "companies", deal: "deals", ticket: "tickets" };

export async function getHubspotProgress(workspaceId: string): Promise<HsProgress | null> {
  const s = await db.appSetting.findUnique({ where: { key: settingKey(workspaceId) } });
  return (s?.value as HsProgress | undefined) ?? null;
}

async function save(workspaceId: string, p: HsProgress) {
  p.updatedAt = new Date().toISOString();
  const value = p as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: settingKey(workspaceId) }, create: { key: settingKey(workspaceId), value }, update: { value } });
}

async function wipeKeys(runId: string) {
  await db.$executeRaw`UPDATE "Job" SET payload = payload - 'key' WHERE type = 'migrate.hubspot' AND payload->>'runId' = ${runId}`;
}

export async function startHubspotImport(workspaceId: string, token: string, startedBy: string) {
  const current = await getHubspotProgress(workspaceId);
  if (current?.status === "running") throw new Error("Es läuft bereits ein HubSpot-Import für diesen Sub-Account.");
  // Zugang sofort prüfen, damit Fehler direkt im Formular erscheinen
  await hsGet(token, "/crm/v3/objects/contacts", { limit: 1 });
  await ensureObjectDefaults(workspaceId);
  const runId = randomUUID();
  const now = new Date().toISOString();
  await save(workspaceId, {
    runId,
    status: "running",
    phase: "owners",
    counts: { owners: 0, properties: 0, pipelines: 0, companies: 0, contacts: 0, deals: 0, tickets: 0, notes: 0, created: 0, updated: 0, skipped: 0, suppressed: 0 },
    ownerMap: {},
    stageMap: {},
    pipelineMap: {},
    customProps: { contact: [], company: [], deal: [], ticket: [] },
    errors: [],
    startedAt: now,
    updatedAt: now,
    startedBy,
  });
  await enqueue("migrate.hubspot", { workspaceId, runId, phase: "owners", after: null, key: seal(token), stepId: randomUUID() });
  return runId;
}

export async function cancelHubspotImport(workspaceId: string) {
  const p = await getHubspotProgress(workspaceId);
  if (!p) return;
  if (p.status === "running") {
    p.status = "cancelled";
    p.finishedAt = new Date().toISOString();
    await save(workspaceId, p);
  }
  await wipeKeys(p.runId);
  await db.job.updateMany({ where: { type: "migrate.hubspot", status: "queued", payload: { path: ["runId"], equals: p.runId } }, data: { status: "done", lastError: "abgebrochen" } });
}

/** Endgültig gescheitert: Fortschritt markieren und Schlüssel entfernen (aus onJobFailed). */
export async function failHubspotRun(workspaceId: string, runId: string, reason: string) {
  const p = await getHubspotProgress(workspaceId);
  if (p && p.runId === runId && p.status === "running") {
    p.status = "failed";
    p.errors = [...p.errors, reason].slice(-20);
    p.finishedAt = new Date().toISOString();
    await save(workspaceId, p);
  }
  await wipeKeys(runId);
}

const nextPhase = (ph: HsPhase): HsPhase => HS_PHASES[HS_PHASES.indexOf(ph) + 1] ?? "done";

/** Eine Etappe ausführen. Wird vom Worker aufgerufen. */
export async function runHubspotStep(payload: HsStepPayload) {
  const { workspaceId, runId } = payload;
  const p = await getHubspotProgress(workspaceId);
  if (!p || p.runId !== runId || p.status !== "running") {
    await wipeKeys(runId);
    return;
  }
  if (!payload.key) throw new Error("HubSpot-Schlüssel fehlt im Job (bereits entfernt). Import bitte neu starten.");
  const token = open(payload.key);

  let next: { phase: HsPhase; after: string | null };
  try {
    next = await processPhase(workspaceId, token, payload.phase, payload.after ?? null, p);
  } catch (err) {
    if (err instanceof HubspotAuthError) {
      p.status = "failed";
      p.errors.push(err.message);
      p.finishedAt = new Date().toISOString();
      await save(workspaceId, p);
      await wipeKeys(runId);
      return;
    }
    p.errors = [...p.errors, `${payload.phase}: ${err instanceof Error ? err.message : String(err)}`].slice(-20);
    await save(workspaceId, p);
    throw err; // Worker wiederholt die Etappe
  }

  if (next.phase === "done") {
    p.phase = "done";
    p.status = "done";
    p.finishedAt = new Date().toISOString();
    await save(workspaceId, p);
    await wipeKeys(runId);
    return;
  }
  p.phase = next.phase;
  await save(workspaceId, p);
  await enqueue("migrate.hubspot", { workspaceId, runId, phase: next.phase, after: next.after, key: payload.key, stepId: randomUUID() });
  await db.$executeRaw`UPDATE "Job" SET payload = payload - 'key' WHERE type = 'migrate.hubspot' AND payload->>'stepId' = ${payload.stepId}`;
}

function paged<T>(r: HsPage<T>, phase: HsPhase): { phase: HsPhase; after: string | null } {
  const after = r.paging?.next?.after;
  return after ? { phase, after } : { phase: nextPhase(phase), after: null };
}

async function listPage(token: string, obj: Obj, std: string[], p: HsProgress, after: string | null, associations: string[]) {
  const props = [...std, ...p.customProps[obj].map((c) => c.name)];
  return hsGet<HsPage<HsObject>>(token, `/crm/v3/objects/${HS_OBJECT[obj]}`, {
    limit: PAGE,
    after: after ?? undefined,
    properties: props.join(","),
    associations: associations.join(",") || undefined,
  });
}

async function idByRef(model: "company" | "contact" | "deal" | "ticket", workspaceId: string, ids: string[]): Promise<string | null> {
  for (const id of ids) {
    const where = { workspaceId, externalRef: ref(id) };
    const hit =
      model === "company" ? await db.company.findFirst({ where, select: { id: true } })
      : model === "contact" ? await db.contact.findFirst({ where, select: { id: true } })
      : model === "deal" ? await db.deal.findFirst({ where, select: { id: true } })
      : await db.ticket.findFirst({ where, select: { id: true } });
    if (hit) return hit.id;
  }
  return null;
}

const owner = (p: HsProgress, v: unknown) => (v ? p.ownerMap[String(v)] ?? null : null);
const dateOf = (v: unknown) => {
  if (!v) return null;
  const d = new Date(/^\d+$/.test(String(v)) ? Number(v) : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const str = (v: unknown, max = 200) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

async function processPhase(workspaceId: string, token: string, phase: HsPhase, after: string | null, p: HsProgress): Promise<{ phase: HsPhase; after: string | null }> {
  switch (phase) {
    case "owners": {
      const r = await hsGet<HsPage<HsOwner>>(token, "/crm/v3/owners", { limit: PAGE, after: after ?? undefined });
      const emails = r.results.map((o) => o.email?.toLowerCase()).filter((e): e is string => !!e);
      // Nur Benutzer mit Zugriff auf diesen Sub-Account kommen als Zuständige infrage
      const users = await db.user.findMany({
        where: { email: { in: emails }, OR: [{ isAgencyAdmin: true }, { memberships: { some: { workspaceId } } }] },
        select: { id: true, email: true },
      });
      for (const o of r.results) {
        p.ownerMap[String(o.id)] = users.find((u) => u.email === o.email?.toLowerCase())?.id ?? null;
        p.counts.owners++;
      }
      return paged(r, phase);
    }
    case "properties": {
      for (const obj of ["contact", "company", "deal", "ticket"] as Obj[]) {
        const r = await hsGet<{ results: HsProperty[] }>(token, `/crm/v3/properties/${HS_OBJECT[obj]}`);
        const custom = r.results.filter((x) => x.hubspotDefined !== true && !x.calculated).slice(0, MAX_CUSTOM);
        p.customProps[obj] = custom.map((c) => ({ name: c.name, type: mapPropertyType(c.type, c.fieldType) }));
        for (const c of custom) {
          const type = mapPropertyType(c.type, c.fieldType);
          const options = type === "select" ? c.options?.map((o) => ({ value: o.value, label: o.label })) : undefined;
          await db.propertyDefinition.upsert({
            where: { workspaceId_objectType_key: { workspaceId, objectType: obj, key: c.name } },
            create: { workspaceId, objectType: obj, key: c.name, label: String(c.label || c.name).slice(0, 120), type, options, source: "hubspot" },
            update: {},
          });
          p.counts.properties++;
        }
      }
      return { phase: nextPhase(phase), after: null };
    }
    case "pipelines": {
      for (const obj of ["deal", "ticket"] as const) {
        const r = await hsGet<{ results: HsPipeline[] }>(token, `/crm/v3/pipelines/${HS_OBJECT[obj]}`);
        for (const hp of r.results) {
          const name = `${String(hp.label).slice(0, 100)} (HubSpot)`;
          let pipe = await db.pipeline.findFirst({ where: { workspaceId, objectType: obj, name }, include: { stages: true } });
          if (!pipe) pipe = await db.pipeline.create({ data: { workspaceId, objectType: obj, name }, include: { stages: true } });
          p.pipelineMap[`${obj}:${hp.id}`] = pipe.id;
          const sorted = [...hp.stages].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
          let pos = pipe.stages.length;
          for (const s of sorted) {
            const label = String(s.label).slice(0, 100);
            let stage = pipe.stages.find((x) => x.name === label);
            if (!stage) {
              stage = await db.stage.create({ data: { pipelineId: pipe.id, name: label, position: pos++, kind: obj === "deal" ? dealStageKind(s) : ticketStageKind(s) } });
            }
            p.stageMap[`${obj}:${s.id}`] = stage.id;
          }
          p.counts.pipelines++;
        }
      }
      return { phase: nextPhase(phase), after: null };
    }
    case "companies": {
      const r = await listPage(token, "company", COMPANY_STD, p, after, []);
      for (const rec of r.results) await importCompany(workspaceId, rec, p);
      return paged(r, phase);
    }
    case "contacts": {
      const r = await listPage(token, "contact", CONTACT_STD, p, after, ["companies"]);
      for (const rec of r.results) await importContact(workspaceId, rec, p);
      return paged(r, phase);
    }
    case "deals": {
      const r = await listPage(token, "deal", DEAL_STD, p, after, ["contacts", "companies"]);
      for (const rec of r.results) await importDeal(workspaceId, rec, p);
      return paged(r, phase);
    }
    case "tickets": {
      const r = await listPage(token, "ticket", TICKET_STD, p, after, ["contacts", "companies"]);
      for (const rec of r.results) await importTicket(workspaceId, rec, p);
      return paged(r, phase);
    }
    case "notes": {
      const r = await hsGet<HsPage<HsObject>>(token, "/crm/v3/objects/notes", {
        limit: PAGE,
        after: after ?? undefined,
        properties: "hs_note_body,hs_timestamp",
        associations: "contacts,companies,deals,tickets",
      });
      for (const rec of r.results) await importNote(workspaceId, rec, p);
      return paged(r, phase);
    }
    default:
      return { phase: "done", after: null };
  }
}

async function importCompany(workspaceId: string, rec: HsObject, p: HsProgress) {
  const pr = rec.properties ?? {};
  const name = str(pr.name) ?? str(pr.domain) ?? `HubSpot-Unternehmen ${rec.id}`;
  const domain = normalizeDomain(str(pr.domain, 253));
  const data = {
    industry: str(pr.industry, 120),
    phone: str(pr.phone, 50),
    address: companyAddress(pr),
    website: str(pr.website, 300),
    size: str(pr.numberofemployees, 60),
    lifecycleStage: mapLifecycle(pr.lifecyclestage),
    ownerId: owner(p, pr.hubspot_owner_id),
  };
  const attrs = customValues(pr, p.customProps.company);
  const existing =
    (await db.company.findFirst({ where: { workspaceId, externalRef: ref(rec.id) } })) ??
    (domain ? await db.company.findUnique({ where: { workspaceId_domain: { workspaceId, domain } } }) : null);
  if (existing) {
    // Nur Lücken füllen, nichts überschreiben
    const fill = Object.fromEntries(Object.entries(data).filter(([k, v]) => v && !existing[k as keyof typeof data]));
    await db.company.update({
      where: { id: existing.id },
      data: { ...fill, externalRef: existing.externalRef ?? ref(rec.id), attributes: { ...attrs, ...((existing.attributes as Record<string, unknown>) ?? {}) } as Prisma.InputJsonObject },
    });
    p.counts.updated++;
  } else {
    await db.$transaction(async (tx) => {
      const c = await tx.company.create({ data: { workspaceId, name, domain, ...data, attributes: attrs as Prisma.InputJsonObject, externalRef: ref(rec.id) } });
      await emitEvent({ workspaceId, type: "company.created", objectType: "company", objectId: c.id, data: { source: SOURCE, import: true } }, tx);
    });
    p.counts.created++;
  }
  p.counts.companies++;
}

const LC = DEFAULT_LIFECYCLE.map((s, i) => ({ key: s.key, label: s.label, position: i }));

async function importContact(workspaceId: string, rec: HsObject, p: HsProgress) {
  const pr = rec.properties ?? {};
  const email = str(pr.email, 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    p.counts.skipped++;
    return;
  }
  const fields = {
    firstName: str(pr.firstname),
    lastName: str(pr.lastname),
    phone: str(pr.phone, 50) ?? str(pr.mobilephone, 50),
    company: str(pr.company),
  };
  if (!email && !fields.firstName && !fields.lastName) {
    p.counts.skipped++;
    return;
  }
  const lifecycle = mapLifecycle(pr.lifecyclestage);
  const optedOut = isTrue(pr.hs_email_optout);
  const consent = !optedOut && hasConsentBasis(pr.hs_legal_basis);
  const createdAt = dateOf(pr.createdate) ?? new Date();
  const companyId = await idByRef("company", workspaceId, assocIds(rec, "companies"));
  const ownerId = owner(p, pr.hubspot_owner_id);
  const attrs = customValues(pr, p.customProps.contact);

  const existing =
    (await db.contact.findFirst({ where: { workspaceId, externalRef: ref(rec.id) } })) ??
    (email ? await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } }) : null);

  if (existing) {
    const fill = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && !existing[k as keyof typeof fields]));
    // Lifecycle nur vorwärts übernehmen
    const lc = lifecycle && lifecycle !== existing.lifecycleStage && !isBackward(LC, existing.lifecycleStage, lifecycle) ? lifecycle : undefined;
    await db.contact.update({
      where: { id: existing.id },
      data: {
        ...fill,
        lifecycleStage: lc,
        companyId: existing.companyId ?? companyId,
        ownerId: existing.ownerId ?? ownerId,
        externalRef: existing.externalRef ?? ref(rec.id),
        attributes: { ...attrs, ...((existing.attributes as Record<string, unknown>) ?? {}) } as Prisma.InputJsonObject,
        tags: existing.tags.includes(TAG) ? undefined : { push: TAG },
        ...(consent && !existing.consentEmailAt && !existing.unsubscribedAt ? { consentEmailAt: createdAt, consentSource: `${SOURCE} (hs_legal_basis)` } : {}),
        ...(optedOut && !existing.unsubscribedAt ? { unsubscribedAt: new Date() } : {}),
      },
    });
    p.counts.updated++;
  } else {
    await db.$transaction(async (tx) => {
      const c = await tx.contact.create({
        data: {
          workspaceId,
          email,
          ...fields,
          lifecycleStage: lifecycle ?? "lead",
          companyId,
          ownerId,
          externalRef: ref(rec.id),
          attributes: attrs as Prisma.InputJsonObject,
          tags: [TAG],
          source: "HubSpot-Import",
          ...(consent ? { consentEmailAt: createdAt, consentSource: `${SOURCE} (hs_legal_basis)` } : {}),
          ...(optedOut ? { unsubscribedAt: new Date() } : {}),
        },
      });
      // import: true → Prozesse können Importe ausschließen (keine Willkommensmails an Bestandskontakte)
      await emitEvent({ workspaceId, type: "contact.created", objectType: "contact", objectId: c.id, data: { source: SOURCE, import: true } }, tx);
    });
    p.counts.created++;
  }
  if (optedOut && email) {
    await db.suppression.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: { workspaceId, email, reason: "unsubscribed", source: SOURCE },
      update: {},
    });
    p.counts.suppressed++;
  }
  p.counts.contacts++;
}

async function fallbackStage(workspaceId: string, objectType: "deal" | "ticket") {
  const pipe = await db.pipeline.findFirst({ where: { workspaceId, objectType }, orderBy: { createdAt: "asc" }, include: { stages: { orderBy: { position: "asc" } } } });
  return pipe?.stages[0] ?? null;
}

async function importDeal(workspaceId: string, rec: HsObject, p: HsProgress) {
  const pr = rec.properties ?? {};
  const stageId = p.stageMap[`deal:${String(pr.dealstage ?? "")}`] ?? (await fallbackStage(workspaceId, "deal"))?.id;
  const stage = stageId ? await db.stage.findUnique({ where: { id: stageId } }) : null;
  if (!stage) {
    p.counts.skipped++;
    return;
  }
  const contactId = await idByRef("contact", workspaceId, assocIds(rec, "contacts"));
  const companyId = await idByRef("company", workspaceId, assocIds(rec, "companies"));
  const data = {
    title: str(pr.dealname) ?? `HubSpot-Deal ${rec.id}`,
    valueCents: centsFromAmount(pr.amount),
    pipelineId: stage.pipelineId,
    stageId: stage.id,
    contactId,
    companyId,
    ownerId: owner(p, pr.hubspot_owner_id),
    closedAt: stage.kind === "OPEN" ? null : dateOf(pr.closedate) ?? new Date(),
  };
  const existing = await db.deal.findFirst({ where: { workspaceId, externalRef: ref(rec.id) } });
  if (existing) {
    await db.deal.update({ where: { id: existing.id }, data });
    p.counts.updated++;
  } else {
    await db.$transaction(async (tx) => {
      const d = await tx.deal.create({ data: { workspaceId, ...data, externalRef: ref(rec.id) } });
      await emitEvent({ workspaceId, type: "deal.created", objectType: "deal", objectId: d.id, data: { source: SOURCE, import: true, stageId: stage.id } }, tx);
    });
    p.counts.created++;
  }
  p.counts.deals++;
}

async function importTicket(workspaceId: string, rec: HsObject, p: HsProgress) {
  const pr = rec.properties ?? {};
  const stageId = p.stageMap[`ticket:${String(pr.hs_pipeline_stage ?? "")}`] ?? (await fallbackStage(workspaceId, "ticket"))?.id;
  const stage = stageId ? await db.stage.findUnique({ where: { id: stageId } }) : null;
  if (!stage) {
    p.counts.skipped++;
    return;
  }
  const data = {
    subject: str(pr.subject, 300) ?? `HubSpot-Ticket ${rec.id}`,
    description: pr.content ? stripHtml(pr.content, 20_000) : null,
    priority: mapPriority(pr.hs_ticket_priority),
    source: "import",
    pipelineId: stage.pipelineId,
    stageId: stage.id,
    contactId: await idByRef("contact", workspaceId, assocIds(rec, "contacts")),
    companyId: await idByRef("company", workspaceId, assocIds(rec, "companies")),
    ownerId: owner(p, pr.hubspot_owner_id),
    closedAt: stage.kind === "CLOSED" ? dateOf(pr.closed_date) ?? new Date() : null,
  };
  const existing = await db.ticket.findFirst({ where: { workspaceId, externalRef: ref(rec.id) } });
  if (existing) {
    await db.ticket.update({ where: { id: existing.id }, data });
    p.counts.updated++;
  } else {
    await db.$transaction(async (tx) => {
      const t = await tx.ticket.create({ data: { workspaceId, ...data, externalRef: ref(rec.id) } });
      await emitEvent({ workspaceId, type: "ticket.created", objectType: "ticket", objectId: t.id, data: { source: SOURCE, import: true, stageId: stage.id } }, tx);
    });
    p.counts.created++;
  }
  p.counts.tickets++;
}

async function importNote(workspaceId: string, rec: HsObject, p: HsProgress) {
  const pr = rec.properties ?? {};
  const body = stripHtml(pr.hs_note_body);
  if (!body) {
    p.counts.skipped++;
    return;
  }
  const dup = await db.activity.findFirst({ where: { workspaceId, meta: { path: ["hubspotNoteId"], equals: String(rec.id) } }, select: { id: true } });
  if (dup) {
    p.counts.notes++;
    return;
  }
  const contactId = await idByRef("contact", workspaceId, assocIds(rec, "contacts"));
  const companyId = await idByRef("company", workspaceId, assocIds(rec, "companies"));
  const dealId = await idByRef("deal", workspaceId, assocIds(rec, "deals"));
  const ticketId = await idByRef("ticket", workspaceId, assocIds(rec, "tickets"));
  if (!contactId && !companyId && !dealId && !ticketId) {
    p.counts.skipped++;
    return;
  }
  await db.activity.create({
    data: {
      workspaceId,
      contactId,
      type: "NOTE",
      body: `HubSpot-Notiz: ${body}`,
      meta: { hubspotNoteId: String(rec.id), companyId, dealId, ticketId, source: SOURCE },
      createdAt: dateOf(pr.hs_timestamp) ?? undefined,
    },
  });
  p.counts.notes++;
}

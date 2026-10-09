import "server-only";
import { emitEvent } from "@/lib/events";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { enqueue } from "../jobs";
import { fromBrevoType } from "../properties";
import { brevoGet, BrevoAuthError, type BrevoAttribute, type BrevoBlocked, type BrevoContact, type BrevoList, type BrevoTemplate } from "./brevo-client";
import { mapBlockReason, normalizeEmail, splitBrevoAttributes, STANDARD_ATTRS, DOI_ATTRS, normalizeAttrKey } from "./brevo-map";
import { open, seal } from "./secretbox";

// Brevo → CRM in Etappen. Jede Etappe = ein Job (eine Seite), danach wird die nächste eingereiht.
// Idempotent: Kontakte über E-Mail, Listen/Vorlagen über `source = "brevo:<id>"`.

export const PHASES = ["attributes", "lists", "contacts", "blocked", "templates", "done"] as const;
export type Phase = (typeof PHASES)[number];

export type Progress = {
  runId: string;
  status: "running" | "done" | "failed" | "cancelled";
  phase: Phase;
  counts: { attributes: number; lists: number; contacts: number; created: number; updated: number; suppressed: number; templates: number; skipped: number };
  totalContacts?: number;
  listMap: Record<string, { id: string; numericId: number; name: string }>;
  templateMap: { brevoId: number; numericId: number; name: string }[];
  errors: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  startedBy?: string;
};

export type StepPayload = { workspaceId: string; runId: string; phase: Phase; offset: number; key?: string | null; stepId: string };

const settingKey = (workspaceId: string) => `migrate:brevo:${workspaceId}`;
const PAGE = { lists: 50, contacts: 500, blocked: 100, templates: 50 } as const;
const TAG = "import-brevo";
const SOURCE = "import:brevo";

export async function getProgress(workspaceId: string): Promise<Progress | null> {
  const s = await db.appSetting.findUnique({ where: { key: settingKey(workspaceId) } });
  return (s?.value as Progress | undefined) ?? null;
}

async function saveProgress(workspaceId: string, p: Progress) {
  p.updatedAt = new Date().toISOString();
  const value = p as unknown as Prisma.InputJsonValue;
  await db.appSetting.upsert({ where: { key: settingKey(workspaceId) }, create: { key: settingKey(workspaceId), value }, update: { value } });
}

/** Entfernt den (verschlüsselten) Brevo-Schlüssel aus allen Jobs eines Laufs. */
async function wipeKeys(runId: string) {
  await db.$executeRaw`UPDATE "Job" SET payload = payload - 'key' WHERE type = 'migrate.brevo' AND payload->>'runId' = ${runId}`;
}

export async function startBrevoImport(workspaceId: string, apiKey: string, startedBy: string) {
  const current = await getProgress(workspaceId);
  if (current?.status === "running") throw new Error("Es läuft bereits ein Brevo-Import für diesen Sub-Account.");
  // Schlüssel sofort prüfen, damit Fehler direkt im Formular erscheinen
  await brevoGet(apiKey, "/contacts/lists", { limit: 1, offset: 0 });
  const runId = randomUUID();
  const now = new Date().toISOString();
  await saveProgress(workspaceId, {
    runId,
    status: "running",
    phase: "attributes",
    counts: { attributes: 0, lists: 0, contacts: 0, created: 0, updated: 0, suppressed: 0, templates: 0, skipped: 0 },
    listMap: {},
    templateMap: [],
    errors: [],
    startedAt: now,
    updatedAt: now,
    startedBy,
  });
  await enqueue("migrate.brevo", { workspaceId, runId, phase: "attributes", offset: 0, key: seal(apiKey), stepId: randomUUID() });
  return runId;
}

export async function cancelBrevoImport(workspaceId: string) {
  const p = await getProgress(workspaceId);
  if (!p) return;
  if (p.status === "running") {
    p.status = "cancelled";
    p.finishedAt = new Date().toISOString();
    await saveProgress(workspaceId, p);
  }
  await wipeKeys(p.runId);
  await db.job.updateMany({ where: { type: "migrate.brevo", status: "queued", payload: { path: ["runId"], equals: p.runId } }, data: { status: "done", lastError: "abgebrochen" } });
}

/** Eine Etappe ausführen. Wird vom Worker aufgerufen. */
export async function runStep(payload: StepPayload) {
  const { workspaceId, runId } = payload;
  const p = await getProgress(workspaceId);
  if (!p || p.runId !== runId || p.status !== "running") {
    await wipeKeys(runId);
    return;
  }
  if (!payload.key) throw new Error("Brevo-Schlüssel fehlt im Job (bereits entfernt). Import bitte neu starten.");
  const apiKey = open(payload.key);

  let next: { phase: Phase; offset: number } | null = null;
  try {
    next = await processPhase(workspaceId, apiKey, payload.phase, payload.offset, p);
  } catch (err) {
    if (err instanceof BrevoAuthError) {
      p.status = "failed";
      p.errors.push(err.message);
      p.finishedAt = new Date().toISOString();
      await saveProgress(workspaceId, p);
      await wipeKeys(runId);
      return;
    }
    p.errors = [...p.errors, `${payload.phase}@${payload.offset}: ${err instanceof Error ? err.message : String(err)}`].slice(-20);
    await saveProgress(workspaceId, p);
    throw err; // Worker wiederholt die Etappe
  }

  if (!next || next.phase === "done") {
    p.phase = "done";
    p.status = "done";
    p.finishedAt = new Date().toISOString();
    await saveProgress(workspaceId, p);
    await wipeKeys(runId);
    return;
  }
  p.phase = next.phase;
  await saveProgress(workspaceId, p);
  await enqueue("migrate.brevo", { workspaceId, runId, phase: next.phase, offset: next.offset, key: payload.key, stepId: randomUUID() });
  // Schlüssel aus dem gerade erledigten Job entfernen
  await db.$executeRaw`UPDATE "Job" SET payload = payload - 'key' WHERE type = 'migrate.brevo' AND payload->>'stepId' = ${payload.stepId}`;
}

const nextPhase = (ph: Phase): Phase => PHASES[PHASES.indexOf(ph) + 1] ?? "done";

async function processPhase(workspaceId: string, apiKey: string, phase: Phase, offset: number, p: Progress): Promise<{ phase: Phase; offset: number }> {
  switch (phase) {
    case "attributes": {
      const r = await brevoGet<{ attributes?: BrevoAttribute[] }>(apiKey, "/contacts/attributes");
      for (const a of r.attributes ?? []) {
        const key = normalizeAttrKey(a.name);
        if (!key || STANDARD_ATTRS[key] || DOI_ATTRS.includes(key)) continue;
        if (!["normal", "category"].includes(a.category)) continue; // global/calculated/transactional nicht übernehmen
        const type = a.category === "category" ? "select" : fromBrevoType(a.type);
        const options = a.enumeration?.map((e) => ({ value: e.label, label: e.label }));
        await db.propertyDefinition.upsert({
          where: { workspaceId_objectType_key: { workspaceId, objectType: "contact", key } },
          create: { workspaceId, objectType: "contact", key, label: key, type, options, source: "brevo" },
          update: {},
        });
        p.counts.attributes++;
      }
      return { phase: nextPhase(phase), offset: 0 };
    }
    case "lists": {
      const r = await brevoGet<{ lists?: BrevoList[]; count?: number }>(apiKey, "/contacts/lists", { limit: PAGE.lists, offset, sort: "asc" });
      for (const l of r.lists ?? []) {
        const source = `brevo:${l.id}`;
        const name = String(l.name).slice(0, 120) || `Brevo-Liste ${l.id}`;
        let list = await db.contactList.findFirst({ where: { workspaceId, source } });
        if (!list) {
          const byName = await db.contactList.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
          list = byName
            ? await db.contactList.update({ where: { id: byName.id }, data: { source: byName.source ?? source } })
            : await db.contactList.create({ data: { workspaceId, name, source } });
        }
        p.listMap[String(l.id)] = { id: list.id, numericId: list.numericId, name: list.name };
        p.counts.lists++;
      }
      const done = (r.lists?.length ?? 0) < PAGE.lists;
      return done ? { phase: nextPhase(phase), offset: 0 } : { phase, offset: offset + PAGE.lists };
    }
    case "contacts": {
      const r = await brevoGet<{ contacts?: BrevoContact[]; count?: number }>(apiKey, "/contacts", { limit: PAGE.contacts, offset, sort: "asc" });
      p.totalContacts = r.count ?? p.totalContacts;
      for (const bc of r.contacts ?? []) await importContact(workspaceId, bc, p);
      const done = (r.contacts?.length ?? 0) < PAGE.contacts;
      return done ? { phase: nextPhase(phase), offset: 0 } : { phase, offset: offset + PAGE.contacts };
    }
    case "blocked": {
      const r = await brevoGet<{ contacts?: BrevoBlocked[] }>(apiKey, "/smtp/blockedContacts", { limit: PAGE.blocked, offset, sort: "asc" });
      for (const b of r.contacts ?? []) {
        const email = normalizeEmail(b.email);
        if (!email) continue;
        const reason = mapBlockReason(b.reason?.code);
        await db.suppression.upsert({
          where: { workspaceId_email: { workspaceId, email } },
          create: { workspaceId, email, reason, source: SOURCE },
          update: {},
        });
        if (reason === "unsubscribed") {
          await db.contact.updateMany({ where: { workspaceId, email, unsubscribedAt: null }, data: { unsubscribedAt: b.blockedAt ? new Date(b.blockedAt) : new Date() } });
        }
        p.counts.suppressed++;
      }
      const done = (r.contacts?.length ?? 0) < PAGE.blocked;
      return done ? { phase: nextPhase(phase), offset: 0 } : { phase, offset: offset + PAGE.blocked };
    }
    case "templates": {
      const r = await brevoGet<{ templates?: BrevoTemplate[] }>(apiKey, "/smtp/templates", { limit: PAGE.templates, offset, sort: "asc" });
      for (const t of r.templates ?? []) {
        const source = `brevo:${t.id}`;
        const data = {
          name: String(t.name ?? `Brevo-Vorlage ${t.id}`).slice(0, 200),
          subject: String(t.subject ?? "").slice(0, 500),
          html: String(t.htmlContent ?? ""),
          senderName: t.sender?.name ?? null,
          senderEmail: t.sender?.email ?? null,
          replyTo: t.replyTo ?? null,
          isActive: t.isActive ?? true,
        };
        const existing = await db.emailTemplate.findFirst({ where: { workspaceId, source } });
        const tpl = existing
          ? await db.emailTemplate.update({ where: { id: existing.id }, data })
          : await db.emailTemplate.create({ data: { ...data, workspaceId, source } });
        p.templateMap = [...p.templateMap.filter((m) => m.brevoId !== t.id), { brevoId: t.id, numericId: tpl.numericId, name: tpl.name }];
        p.counts.templates++;
      }
      const done = (r.templates?.length ?? 0) < PAGE.templates;
      return done ? { phase: "done", offset: 0 } : { phase, offset: offset + PAGE.templates };
    }
    default:
      return { phase: "done", offset: 0 };
  }
}

async function importContact(workspaceId: string, bc: BrevoContact, p: Progress) {
  const email = normalizeEmail(bc.email);
  if (!email) {
    p.counts.skipped++;
    return;
  }
  const { fields, extra, doi } = splitBrevoAttributes(bc.attributes, 200);
  const existing = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
  const blacklisted = bc.emailBlacklisted === true;
  const createdAt = bc.createdAt ? new Date(bc.createdAt) : new Date();

  let contactId: string;
  if (existing) {
    // Vorhandene Werte nicht überschreiben, nur Lücken füllen; Brevo-Attribute ergänzen
    const fill = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && !existing[k as keyof typeof fields]));
    await db.contact.update({
      where: { id: existing.id },
      data: {
        ...fill,
        attributes: { ...((existing.attributes as Record<string, unknown>) ?? {}), ...extra } as Prisma.InputJsonObject,
        tags: existing.tags.includes(TAG) ? undefined : { push: TAG },
        ...(doi && !existing.consentEmailAt ? { consentEmailAt: createdAt, consentSource: `${SOURCE} (DOUBLE_OPT-IN)` } : {}),
        ...(blacklisted && !existing.unsubscribedAt ? { unsubscribedAt: new Date() } : {}),
      },
    });
    contactId = existing.id;
    p.counts.updated++;
  } else {
    const c = await db.contact.create({
      data: {
        workspaceId,
        email,
        ...fields,
        attributes: extra as Prisma.InputJsonObject,
        tags: [TAG],
        source: "Brevo-Import",
        ...(doi ? { consentEmailAt: createdAt, consentSource: `${SOURCE} (DOUBLE_OPT-IN)` } : {}),
        ...(blacklisted ? { unsubscribedAt: new Date() } : {}),
      },
    });
    await emitEvent({ workspaceId, type: "contact.created", objectType: "contact", objectId: c.id, data: { import: true, source: "brevo" } });
    contactId = c.id;
    p.counts.created++;
  }
  if (blacklisted) {
    await db.suppression.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: { workspaceId, email, reason: "unsubscribed", source: SOURCE },
      update: {},
    });
  }
  const listIds = (bc.listIds ?? []).map((id) => p.listMap[String(id)]?.id).filter((x): x is string => !!x);
  if (listIds.length) {
    await db.contactListMember.createMany({ data: listIds.map((listId) => ({ listId, contactId })), skipDuplicates: true });
  }
  p.counts.contacts++;
}

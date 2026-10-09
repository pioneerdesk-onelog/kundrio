import "server-only";
import { resolveTemplate } from "./defaults";
import { computeAccess } from "@/lib/permissions/core";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requestApproval } from "@/lib/approvals";
import { definitionSchema, emptyDefinition, validateDefinition, type ObjectType, type ProcessDefinition, type ValidationResult } from "./definition";
import { validateFull } from "./references";
import { getTemplate, PROCESS_TEMPLATES } from "./templates";
import { cancelOpenRuns, resumePausedRuns } from "./engine";

// Öffentliche Schnittstelle der Prozess-Engine für Flow-Editor (UI) und MCP-Server.
// Akteur-Format: user:<id> | mcp:<keyId> | system

export type ProcessSummary = { id: string; name: string; objectType: ObjectType; status: string; templateKey: string | null; activeVersion: number | null; draftVersion: number | null };

async function ownProcess(workspaceId: string, processId: string) {
  const p = await db.process.findFirst({ where: { id: processId, workspaceId }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!p) throw new Error("Prozess nicht gefunden.");
  return p;
}

function summarize(p: Awaited<ReturnType<typeof ownProcess>>): ProcessSummary {
  const active = p.versions.find((v) => v.id === p.activeVersionId);
  const draft = p.versions.find((v) => !v.publishedAt);
  return {
    id: p.id,
    name: p.name,
    objectType: p.objectType as ObjectType,
    status: p.status,
    templateKey: p.templateKey,
    activeVersion: active?.version ?? null,
    draftVersion: draft?.version ?? null,
  };
}

/** Rechte eines menschlichen Akteurs (user:<id>) im Sub-Account; andere Akteure (MCP, Prozess) → null. */
async function humanAccess(actor: string, workspaceId: string) {
  if (!actor.startsWith("user:")) return null;
  return computeAccess(actor.slice(5), workspaceId);
}

export async function listProcesses(workspaceId: string): Promise<ProcessSummary[]> {
  const ps = await db.process.findMany({ where: { workspaceId, status: { not: "ARCHIVED" } }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: { name: "asc" } });
  return ps.map(summarize);
}

export async function getProcess(
  workspaceId: string,
  processId: string,
): Promise<{ summary: ProcessSummary; draft: ProcessDefinition | null; active: ProcessDefinition | null; validation: ValidationResult | null }> {
  const p = await ownProcess(workspaceId, processId);
  const active = p.versions.find((v) => v.id === p.activeVersionId);
  const draft = p.versions.find((v) => !v.publishedAt);
  const parse = (v: unknown) => {
    const r = definitionSchema.safeParse(v);
    return r.success ? r.data : null;
  };
  const draftDef = draft ? parse(draft.definition) : null;
  return {
    summary: summarize(p),
    draft: draftDef,
    active: active ? parse(active.definition) : null,
    validation: draft
      ? await validateFull(workspaceId, p.objectType as ObjectType, draft.definition)
      : active
        ? await validateFull(workspaceId, p.objectType as ObjectType, active.definition)
        : null,
  };
}

export async function createProcess(
  workspaceId: string,
  input: { name: string; description?: string; objectType: ObjectType; definition?: ProcessDefinition; templateKey?: string },
  actor: string,
): Promise<{ id: string }> {
  const tpl = input.templateKey ? getTemplate(input.templateKey) : undefined;
  if (input.templateKey && !tpl) throw new Error(`Vorlage „${input.templateKey}“ gibt es nicht.`);
  const objectType = tpl?.objectType ?? input.objectType;
  // Vorlagen-Platzhalter (z. B. Terminvorlage per Name) gegen den Sub-Account auflösen
  const resolvedTpl = tpl && !input.definition ? await resolveTemplate(db, workspaceId, tpl) : null;
  if (tpl && !input.definition && !resolvedTpl) throw new Error(`Für die Vorlage „${tpl.name}“ fehlen Daten in diesem Sub-Account.`);
  const definition = input.definition ?? resolvedTpl ?? emptyDefinition("manual");
  const validation = await validateFull(workspaceId, objectType, definition);
  const p = await db.process.create({
    data: {
      workspaceId,
      name: input.name.trim().slice(0, 120) || tpl?.name || "Neuer Prozess",
      description: input.description?.slice(0, 2000) ?? tpl?.description,
      objectType,
      templateKey: input.templateKey,
      status: "DRAFT",
      versions: {
        create: {
          version: 1,
          definition: definition as unknown as Prisma.InputJsonValue,
          validation: validation as unknown as Prisma.InputJsonValue,
          external: validation.external,
          createdBy: actor,
        },
      },
    },
  });
  await audit({ workspaceId, actor, action: "process.created", target: p.id, detail: { templateKey: input.templateKey ?? null } });
  return { id: p.id };
}

export async function saveDraft(workspaceId: string, processId: string, definition: ProcessDefinition, actor: string): Promise<{ version: number; validation: ValidationResult }> {
  const p = await ownProcess(workspaceId, processId);
  if (p.status === "ARCHIVED") throw new Error("Archivierte Prozesse können nicht bearbeitet werden.");
  // Entwurf wird auch mit Fehlern gespeichert; die Prüfung kommt als Ergebnis zurück
  const validation = await validateFull(workspaceId, p.objectType as ObjectType, definition);
  const data = {
    definition: definition as unknown as Prisma.InputJsonValue,
    validation: validation as unknown as Prisma.InputJsonValue,
    external: validation.external,
    createdBy: actor,
  };
  // Unveröffentlichter Entwurf wird überschrieben; veröffentlichte Versionen bleiben unverändert
  const draft = p.versions.find((v) => !v.publishedAt);
  let version: number;
  if (draft) {
    await db.processVersion.update({ where: { id: draft.id }, data: { ...data, approvedAt: null, approvedBy: null } });
    version = draft.version;
  } else {
    version = (p.versions[0]?.version ?? 0) + 1;
    await db.processVersion.create({ data: { processId, version, ...data } });
  }
  await audit({ workspaceId, actor, action: "process.draft_saved", target: processId, detail: { version, ok: validation.ok } });
  return { version, validation };
}

/** Veröffentlicht eine konkrete Version (auch vom Freigabe-Ausführer genutzt). */
export async function publishVersion(workspaceId: string, processId: string, versionId: string, actor: string, approve: boolean) {
  const p = await ownProcess(workspaceId, processId);
  const v = p.versions.find((x) => x.id === versionId);
  if (!v) throw new Error("Version nicht gefunden.");
  if (v.publishedAt) throw new Error("Version ist bereits veröffentlicht.");
  // Zwingend: Veröffentlichen nur, wenn alle Referenzen im Sub-Account existieren
  const validation = await validateFull(workspaceId, p.objectType as ObjectType, v.definition);
  if (!validation.ok) throw new Error(`Prozess enthält Fehler: ${validation.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
  if (validation.external && !approve) throw new Error("Außenwirkung braucht eine Freigabe.");
  const now = new Date();
  await db.$transaction([
    db.processVersion.update({
      where: { id: v.id },
      data: {
        publishedAt: now,
        publishedBy: actor,
        external: validation.external,
        validation: validation as unknown as Prisma.InputJsonValue,
        ...(validation.external ? { approvedAt: now, approvedBy: actor } : {}),
      },
    }),
    db.process.update({ where: { id: p.id }, data: { activeVersionId: v.id, status: "ACTIVE" } }),
  ]);
  await audit({ workspaceId, actor, action: "process.published", target: p.id, detail: { version: v.version, external: validation.external } });
  await resumePausedRuns(p.id);
  return validation;
}

export async function publishProcess(
  workspaceId: string,
  processId: string,
  actor: string,
): Promise<{ status: "published" | "approval_requested"; approvalId?: string; validation: ValidationResult }> {
  const p = await ownProcess(workspaceId, processId);
  const draft = p.versions.find((v) => !v.publishedAt);
  if (!draft) throw new Error("Es gibt keinen unveröffentlichten Entwurf.");
  const validation = await validateFull(workspaceId, p.objectType as ObjectType, draft.definition);
  if (!validation.ok) {
    throw new Error(`Prozess enthält Fehler: ${validation.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
  }

  // Menschen mit Recht „Prozesse veröffentlichen“: direkt – bei Außenwirkung zusätzlich „Freigaben erteilen“.
  // Alle anderen (z. B. MCP, Menschen ohne diese Rechte): Freigabe-Anfrage im Freigabe-Eingang.
  const access = await humanAccess(actor, workspaceId);
  const mayPublish = !!access && access.perms.objects.processes.edit !== "none" && access.perms.special.publish_processes;
  if (mayPublish && (!validation.external || access.perms.special.approve)) {
    await publishVersion(workspaceId, processId, draft.id, actor, validation.external);
    return { status: "published", validation };
  }
  const a = await requestApproval({
    workspaceId,
    kind: "process.publish",
    title: `Prozess „${p.name}“ veröffentlichen (Version ${draft.version})`,
    summary: validation.external ? "Enthält Aktionen mit Außenwirkung (E-Mail/Webhook)." : "Ohne Außenwirkung.",
    payload: { processId: p.id, versionId: draft.id },
    requestedBy: actor,
  });
  return { status: "approval_requested", approvalId: a.id, validation };
}

export async function setProcessStatus(workspaceId: string, processId: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED", actor: string): Promise<void> {
  const p = await ownProcess(workspaceId, processId);
  if (status === "ACTIVE" && !p.activeVersionId) throw new Error("Erst veröffentlichen, dann aktivieren.");
  if (status === "ACTIVE") {
    const v = p.versions.find((x) => x.id === p.activeVersionId);
    if (v?.external && !v.approvedAt) throw new Error("Die aktive Version ist nicht freigegeben.");
  }
  await db.process.update({ where: { id: p.id }, data: { status } });
  if (status === "ACTIVE") await resumePausedRuns(p.id);
  if (status === "ARCHIVED") await cancelOpenRuns(p.id);
  await audit({ workspaceId, actor, action: `process.${status.toLowerCase()}`, target: p.id });
}

export async function enrollObject(workspaceId: string, processId: string, objectId: string, opts: { actor: string; test?: boolean }): Promise<{ runId: string }> {
  const p = await ownProcess(workspaceId, processId);
  const test = !!opts.test;
  const version = test ? (p.versions.find((v) => !v.publishedAt) ?? p.versions.find((v) => v.id === p.activeVersionId)) : p.versions.find((v) => v.id === p.activeVersionId);
  if (!version) throw new Error(test ? "Keine Version zum Testen vorhanden." : "Prozess ist nicht veröffentlicht.");
  if (!test && p.status !== "ACTIVE") throw new Error("Prozess ist nicht aktiv.");
  const v = validateDefinition(version.definition, p.objectType as ObjectType);
  if (!v.ok) throw new Error("Die Version enthält Fehler und kann nicht laufen.");

  const delegate = { contact: db.contact, company: db.company, deal: db.deal, ticket: db.ticket }[p.objectType as ObjectType] as unknown as {
    findFirst: (a: unknown) => Promise<{ id: string } | null>;
  };
  const obj = await delegate.findFirst({ where: { id: objectId, workspaceId }, select: { id: true } });
  if (!obj) throw new Error("Datensatz nicht gefunden.");

  const run = await db.$transaction(async (tx) => {
    const r = await tx.processRun.create({
      data: {
        workspaceId,
        processId,
        versionId: version.id,
        objectType: p.objectType,
        objectId,
        test,
        dedupeKey: `${processId}:${objectId}:${test ? "test" : "manual"}:${randomUUID()}`,
        context: { _event: { type: "manual", actor: opts.actor }, _depth: 0 },
      },
    });
    await tx.job.create({ data: { type: "process.step", payload: { runId: r.id } } });
    return r;
  });
  await audit({ workspaceId, actor: opts.actor, action: test ? "process.test_run" : "process.enrolled", target: run.id, detail: { processId, objectId } });
  return { runId: run.id };
}

export async function getRun(
  workspaceId: string,
  runId: string,
): Promise<{ id: string; status: string; objectType: string; objectId: string; test: boolean; error: string | null; steps: { nodeId: string; nodeType: string; status: string; detail: unknown; createdAt: Date }[] }> {
  const r = await db.processRun.findFirst({ where: { id: runId, workspaceId }, include: { steps: { orderBy: { createdAt: "asc" } } } });
  if (!r) throw new Error("Lauf nicht gefunden.");
  return {
    id: r.id,
    status: r.status,
    objectType: r.objectType,
    objectId: r.objectId,
    test: r.test,
    error: r.error,
    steps: r.steps.map((s) => ({ nodeId: s.nodeId, nodeType: s.nodeType, status: s.status, detail: s.detail, createdAt: s.createdAt })),
  };
}

export async function listTemplates(): Promise<{ key: string; name: string; description: string; objectType: ObjectType; external: boolean }[]> {
  return PROCESS_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, objectType: t.objectType, external: validateDefinition(t.definition).external }));
}

import "server-only";
import { validateFull } from "@/lib/process/references";
import { z } from "zod";
import { db } from "../db";
import { requestApproval } from "../approvals";
import {
  CONDITION_OPS, NODE_TYPES, NODE_TYPE_KEYS, OBJECT_LABELS, OBJECT_TYPES, OUTPUT_LABELS, TRIGGER_TYPES, outputsOf, validateDefinition,
  type ObjectType, type ProcessDefinition,
} from "../process/definition";
import {
  createProcess, enrollObject, getProcess, getRun, listProcesses, listTemplates, publishProcess, saveDraft, setProcessStatus,
} from "../process/api";
import { DATA_NOTE, McpToolError, approvalLink, idArg, limitArg, need, tool, type McpCtx } from "./context";

// Admin-MCP: Werkzeuge für Prozesse (Workflows). Schwerpunkt: Prozesse per LLM entwerfen, prüfen,
// testen und zur Freigabe einreichen. Veröffentlichen/Aktivieren mit Außenwirkung braucht immer einen Menschen.

const definitionArg = z.record(z.string(), z.unknown()).describe("Prozess-Definition (Aufbau siehe describe_process_schema)");

async function ownProcess(workspaceId: string, processId: string) {
  const p = await db.process.findFirst({ where: { id: processId, workspaceId } });
  if (!p) throw new McpToolError("Prozess nicht gefunden.");
  return p;
}

const OBJECT_KEY = { contact: "contacts", company: "companies", deal: "deals", ticket: "tickets" } as const;

/** Rechte am einzuschreibenden Objekt prüfen (Testlauf: lesen, echte Einschreibung: bearbeiten). */
async function needObject(ctx: McpCtx, objectType: string, objectId: string, action: "read" | "edit") {
  const where = { id: objectId, workspaceId: ctx.workspaceId };
  const select = { ownerId: true } as const;
  const row =
    objectType === "contact" ? await db.contact.findFirst({ where, select })
    : objectType === "company" ? await db.company.findFirst({ where, select })
    : objectType === "deal" ? await db.deal.findFirst({ where, select })
    : objectType === "ticket" ? await db.ticket.findFirst({ where, select })
    : null;
  if (!row) throw new McpToolError("Objekt nicht gefunden (falscher Objekttyp oder ID).");
  need(ctx, OBJECT_KEY[objectType as keyof typeof OBJECT_KEY], action, row.ownerId);
}

async function activeVersionExternal(processId: string, activeVersionId: string | null) {
  if (!activeVersionId) return null;
  const v = await db.processVersion.findFirst({ where: { id: activeVersionId, processId }, select: { external: true, version: true } });
  return v;
}

/** Fehlerobjekt der Engine bzw. Stub in verständlichen Text übersetzen. */
async function engine<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "nicht implementiert") throw new McpToolError("Die Prozess-Engine ist in dieser Installation noch nicht verfügbar.");
    throw new McpToolError(msg.slice(0, 500));
  }
}

/** Katalog für LLMs: alles, was zum Bau einer gültigen Definition nötig ist. */
export function processSchemaCatalog() {
  return {
    hinweis:
      "Ein Prozess besteht aus trigger, enrollment (filters, reenroll), optional goal, start (ID des ersten Knotens), nodes und edges. Prozesse sind azyklisch. Jeder Knoten hat id (a-z, 0-9, _ -), type, config, position. Kanten verbinden from→to über einen Ausgang (output). Zusätzlich darf jeder Knoten einen Ausgang \"error\" haben. Aktionen mit external=true (E-Mail, Webhook) erfordern vor dem Veröffentlichen eine menschliche Freigabe.",
    objectTypes: OBJECT_TYPES.map((t) => ({ key: t, label: OBJECT_LABELS[t] })),
    triggers: Object.entries(TRIGGER_TYPES).map(([key, v]) => ({ key, label: v.label, objectType: v.objectType })),
    triggerConfigBeispiele: {
      "form.submitted": { formId: "<Formular-ID, optional>" },
      "contact.tag_added": { tag: "<Tag>" },
      "contact.list_added": { listId: "<Listen-ID>" },
      "contact.property_changed": { field: "<Feldname>" },
      "contact.lifecycle_changed": { to: "<Lifecycle-Schlüssel, optional>" },
      "deal.stage_changed": { stageId: "<Phase-ID, optional>" },
      "ticket.stage_changed": { stageId: "<Status-ID, optional>" },
      "email.event": { event: "hard_bounce | click | …" },
    },
    conditionOperators: Object.entries(CONDITION_OPS).map(([key, label]) => ({ key, label })),
    fieldPaths:
      "Felder als <objekt>.<feld> bzw. <objekt>.attributes.<KEY>: contact.email, contact.lifecycleStage, contact.tags, contact.trustScore, contact.attributes.BRANCHE, company.domain, deal.valueCents, deal.stage.kind, ticket.priority, event.<feld>, context.<schlüssel>",
    nodeTypes: NODE_TYPE_KEYS.map((key) => {
      const n = NODE_TYPES[key];
      return {
        type: key,
        label: n.label,
        group: n.group,
        external: n.external,
        outputs: outputsOf(key).map((o) => ({ key: o, label: OUTPUT_LABELS[o] ?? o })),
        config: z.toJSONSchema(n.config, { io: "input", unrepresentable: "any" }),
      };
    }),
    beispiel: {
      schemaVersion: 1,
      trigger: { type: "form.submitted", config: {} },
      enrollment: { filters: { match: "all", conditions: [{ field: "contact.email", op: "is_set" }] }, reenroll: false },
      start: "firma",
      nodes: [
        { id: "firma", type: "action.associate_company", config: { createIfMissing: true, ignoreFreemail: true }, position: { x: 0, y: 0 } },
        { id: "phase", type: "action.set_lifecycle", config: { stage: "lead", onlyForward: true }, position: { x: 0, y: 120 } },
        { id: "aufgabe", type: "action.create_task", config: { title: "Neuen Lead innerhalb von 24 h kontaktieren", dueDays: 1, assignTo: "owner" }, position: { x: 0, y: 240 } },
        { id: "ende", type: "logic.end", config: {}, position: { x: 0, y: 360 } },
      ],
      edges: [
        { from: "firma", to: "phase", output: "next" },
        { from: "phase", to: "aufgabe", output: "next" },
        { from: "aufgabe", to: "ende", output: "next" },
      ],
    },
  };
}

export const processTools = [
  tool({
    name: "describe_process_schema",
    title: "Prozess-Bauplan",
    description:
      "Liefert alles, was du zum Bauen einer gültigen Prozess-Definition brauchst: Auslöser, Knotentypen mit Konfigurations-Schema und Ausgängen, Bedingungs-Operatoren, Feldpfade und ein Beispiel. Vor create_process/update_process_draft aufrufen.",
    access: "read",
    perm: null,
    input: z.object({}),
    run: async () => processSchemaCatalog(),
  }),
  tool({
    name: "list_processes",
    title: "Prozesse auflisten",
    description: "Listet alle Prozesse des Sub-Accounts mit Status, Objekttyp, aktiver und Entwurfsversion.",
    access: "read",
    perm: { object: "processes", action: "read" },
    input: z.object({}),
    run: async (_a, ctx) => ({ processes: await engine(() => listProcesses(ctx.workspaceId)) }),
  }),
  tool({
    name: "get_process",
    title: "Prozess abrufen",
    description: "Liefert Entwurf und aktive Definition eines Prozesses samt Prüfergebnis. Knotentypen erklärt describe_process_schema." + DATA_NOTE,
    access: "read",
    perm: { object: "processes", action: "read" },
    input: z.object({ processId: idArg }),
    run: async (a, ctx) => {
      await ownProcess(ctx.workspaceId, a.processId);
      return await engine(() => getProcess(ctx.workspaceId, a.processId));
    },
  }),
  tool({
    name: "list_process_runs",
    title: "Prozessläufe",
    description: "Listet die letzten Läufe eines Prozesses (Status, Objekt, Fehler).",
    access: "read",
    perm: { object: "processes", action: "read" },
    input: z.object({
      processId: idArg,
      status: z.enum(["running", "waiting", "done", "goal_met", "failed", "cancelled"]).optional(),
      includeTests: z.boolean().default(true),
      limit: limitArg,
    }),
    run: async (a, ctx) => {
      await ownProcess(ctx.workspaceId, a.processId);
      const runs = await db.processRun.findMany({
        where: { workspaceId: ctx.workspaceId, processId: a.processId, ...(a.status ? { status: a.status } : {}), ...(a.includeTests ? {} : { test: false }) },
        orderBy: { startedAt: "desc" },
        take: a.limit,
        include: { version: { select: { version: true } } },
      });
      return {
        runs: runs.map((r) => ({
          id: r.id, version: r.version.version, status: r.status, objectType: r.objectType, objectId: r.objectId, currentNodeId: r.currentNodeId,
          test: r.test, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt,
        })),
      };
    },
  }),
  tool({
    name: "get_process_run",
    title: "Prozesslauf im Detail",
    description: "Liefert einen Lauf mit allen Schritten (Knoten, Status, Details, Zeit) – zum Nachvollziehen und Fehlersuchen." + DATA_NOTE,
    access: "read",
    perm: { object: "processes", action: "read" },
    input: z.object({ runId: idArg }),
    run: async (a, ctx) => await engine(() => getRun(ctx.workspaceId, a.runId)),
  }),
  tool({
    name: "list_templates",
    title: "Best-Practice-Vorlagen",
    description: "Listet die Best-Practice-Prozessvorlagen (z. B. Lead-Eingang, Ticket-Eingang), aus denen create_process einen Entwurf erzeugen kann.",
    access: "read",
    perm: { object: "processes", action: "read" },
    input: z.object({}),
    run: async () => ({ templates: await engine(() => listTemplates()) }),
  }),
  tool({
    name: "validate_process",
    title: "Definition prüfen",
    description:
      "Prüft eine Prozess-Definition (Struktur, Knoten-Konfiguration, Verbindungen, Schleifen) UND ob alle Felder, Werte und IDs (Listen, Phasen, Lifecycle, Vorlagen, Webhooks, Personen, Formulare, eigene Felder) in diesem Sub-Account existieren – ohne etwas zu speichern. Ohne objectType wird nur die Struktur geprüft.",
    access: "read",
    perm: { object: "processes", action: "read" },
    input: z.object({ definition: definitionArg, objectType: z.enum(OBJECT_TYPES).optional() }),
    run: async (a, ctx) =>
      a.objectType ? validateFull(ctx.workspaceId, a.objectType as ObjectType, a.definition) : validateDefinition(a.definition, undefined),
  }),
  tool({
    name: "create_process",
    title: "Prozess anlegen (Entwurf)",
    description:
      "Legt einen neuen Prozess als ENTWURF an – leer, aus einer Definition oder aus einer Vorlage (templateKey). Er läuft erst nach publish_process und menschlicher Freigabe.",
    access: "write",
    perm: { object: "processes", action: "edit" },
    input: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).optional(),
      objectType: z.enum(OBJECT_TYPES),
      templateKey: z.string().trim().max(60).optional(),
      definition: definitionArg.optional(),
    }),
    run: async (a, ctx) => {
      let definition: ProcessDefinition | undefined;
      if (a.definition) {
        const v = await validateFull(ctx.workspaceId, a.objectType, a.definition);
        if (!v.ok) return { created: false, validation: v, hinweis: "Definition ist ungültig – bitte korrigieren (siehe issues)." };
        definition = a.definition as unknown as ProcessDefinition;
      }
      const r = await engine(() =>
        createProcess(ctx.workspaceId, { name: a.name, description: a.description, objectType: a.objectType, definition, templateKey: a.templateKey }, ctx.actor),
      );
      return { created: true, processId: r.id, status: "DRAFT" };
    },
  }),
  tool({
    name: "update_process_draft",
    title: "Prozess-Entwurf speichern",
    description:
      "Speichert eine neue Entwurfsversion. Ungültige Definitionen werden NICHT gespeichert; du bekommst die Prüfergebnisse zurück. Veröffentlichte Versionen bleiben unverändert.",
    access: "write",
    perm: { object: "processes", action: "edit" },
    input: z.object({ processId: idArg, definition: definitionArg }),
    run: async (a, ctx) => {
      const p = await ownProcess(ctx.workspaceId, a.processId);
      const v = await validateFull(ctx.workspaceId, p.objectType as ObjectType, a.definition);
      if (!v.ok) return { saved: false, validation: v };
      const r = await engine(() => saveDraft(ctx.workspaceId, p.id, a.definition as unknown as ProcessDefinition, ctx.actor));
      return { saved: true, version: r.version, validation: r.validation };
    },
  }),
  tool({
    name: "test_process",
    title: "Testlauf",
    description:
      "Startet einen Testlauf des aktuellen Entwurfs bzw. der aktiven Version für ein Objekt – OHNE Außenwirkung (keine E-Mails/Webhooks). Ergebnis mit get_process_run ansehen.",
    access: "write",
    perm: { object: "processes", action: "edit" },
    input: z.object({ processId: idArg, objectId: idArg.describe("ID des Kontakts/Unternehmens/Deals/Tickets") }),
    run: async (a, ctx) => {
      const p = await ownProcess(ctx.workspaceId, a.processId);
      await needObject(ctx, p.objectType, a.objectId, "read");
      const r = await engine(() => enrollObject(ctx.workspaceId, a.processId, a.objectId, { actor: ctx.actor, test: true }));
      return { started: true, runId: r.runId, test: true };
    },
  }),
  tool({
    name: "enroll_in_process",
    title: "In Prozess einschreiben",
    description:
      "Schreibt ein Objekt in einen aktiven Prozess ein. Hat die aktive Version Aktionen mit Außenwirkung (E-Mail, Webhook), wird stattdessen eine Freigabe beantragt.",
    access: "write",
    perm: { object: "processes", action: "edit" },
    input: z.object({ processId: idArg, objectId: idArg }),
    run: async (a, ctx) => {
      const p = await ownProcess(ctx.workspaceId, a.processId);
      await needObject(ctx, p.objectType, a.objectId, "edit");
      if (p.status !== "ACTIVE") throw new McpToolError("Prozess ist nicht aktiv.");
      const v = await activeVersionExternal(p.id, p.activeVersionId);
      if (!v) throw new McpToolError("Prozess hat keine veröffentlichte Version.");
      if (v.external) {
        const appr = await requestApproval({
          workspaceId: ctx.workspaceId,
          kind: "process.enroll",
          title: `Einschreiben in „${p.name}“ (mit Außenwirkung)`,
          summary: `Objekt ${a.objectId} soll in Version ${v.version} eingeschrieben werden.`,
          payload: { processId: p.id, objectId: a.objectId },
          requestedBy: ctx.actor,
        });
        return { status: "wartet_auf_freigabe", approvalId: appr.id, link: approvalLink(appr.id) };
      }
      const r = await engine(() => enrollObject(ctx.workspaceId, p.id, a.objectId, { actor: ctx.actor }));
      return { started: true, runId: r.runId };
    },
  }),
  tool({
    name: "publish_process",
    title: "Prozess veröffentlichen (mit Freigabe)",
    description:
      "Reicht den aktuellen Entwurf zur Veröffentlichung ein. Über MCP entsteht IMMER eine Freigabe-Anfrage; ein Mensch prüft und gibt frei. Vorher validate_process und test_process nutzen.",
    access: "approval",
    perm: { object: "processes", action: "edit" },
    input: z.object({ processId: idArg }),
    run: async (a, ctx) => {
      await ownProcess(ctx.workspaceId, a.processId);
      const r = await engine(() => publishProcess(ctx.workspaceId, a.processId, ctx.actor));
      if (r.status === "approval_requested" && r.approvalId) {
        return { status: "wartet_auf_freigabe", approvalId: r.approvalId, link: approvalLink(r.approvalId), validation: r.validation };
      }
      if (r.status === "published") return { status: "veroeffentlicht", validation: r.validation };
      return r;
    },
  }),
  tool({
    name: "set_process_status",
    title: "Prozess aktivieren/pausieren",
    description:
      "Pausiert, archiviert oder aktiviert einen Prozess. Pausieren/Archivieren wirkt sofort. Aktivieren eines Prozesses mit Außenwirkung erzeugt eine Freigabe-Anfrage.",
    access: "write",
    perm: { object: "processes", action: "edit" },
    idempotent: true,
    input: z.object({ processId: idArg, status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) }),
    run: async (a, ctx) => {
      const p = await ownProcess(ctx.workspaceId, a.processId);
      if (a.status === "ACTIVE") {
        const v = await activeVersionExternal(p.id, p.activeVersionId);
        if (!v) throw new McpToolError("Prozess hat keine veröffentlichte Version – erst publish_process.");
        if (v.external) {
          const appr = await requestApproval({
            workspaceId: ctx.workspaceId,
            kind: "process.status",
            title: `Prozess „${p.name}“ aktivieren (mit Außenwirkung)`,
            summary: `Version ${v.version} enthält E-Mail- oder Webhook-Aktionen.`,
            payload: { processId: p.id, status: "ACTIVE" },
            requestedBy: ctx.actor,
          });
          return { status: "wartet_auf_freigabe", approvalId: appr.id, link: approvalLink(appr.id) };
        }
      }
      await engine(() => setProcessStatus(ctx.workspaceId, p.id, a.status, ctx.actor));
      return { updated: true, status: a.status };
    },
  }),
];

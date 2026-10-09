import { Prisma, type CrmEvent } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { definitionSchema, OBJECT_TYPES, TRIGGER_TYPES, type ObjectType, type ProcessDefinition, type ProcessNode } from "./definition";
import { evalGroup } from "./conditions";
import { findNode, hasErrorEdge, nextNodeId } from "./graph";
import { eventDepth, mayTrigger } from "./loop-guard";
import { loadState } from "./state";
import { eventSubject, triggerMatches } from "./matching";

export { triggerMatches };
import { planNode, type Plan } from "./actions";
import { errMessage, log } from "@/lib/log";

// Prozess-Engine.
//  dispatchEvents()  – verteilt Outbox-Ereignisse an aktive Prozesse (Einschreibung = ProcessRun)
//  runProcessStep()  – führt einen Lauf Knoten für Knoten aus (Job "process.step")
//  scheduleDaily()   – zeitbasierte Prozesse (Auslöser "schedule.daily")
//
// Regeln:
//  • Ein Lauf nutzt immer SEINE Version (run.versionId) – nie die aktuelle Definition.
//  • Prozess PAUSIERT: laufende Läufe halten vor dem nächsten Schritt an (status "waiting", context._paused);
//    beim Reaktivieren laufen sie an derselben Stelle weiter. ARCHIVIERT: offene Läufe werden abgebrochen.
//  • Jeder Schritt wird mit seinen Datenänderungen in EINER Transaktion protokolliert (genau einmal).
//    Außenwirkungen (E-Mail) laufen höchstens einmal: vorher Marker „running“ im Schrittprotokoll.
//  • Ereignisse aus Läufen tragen causedByProcess; ein Prozess löst sich damit nie selbst aus; Tiefenlimit 5.

const FINAL = ["done", "goal_met", "failed", "cancelled"];
const MAX_STEPS_PER_JOB = 50;
const WAIT_UNTIL_RECHECK_MS = 15 * 60_000;
const MAX_EVENT_ATTEMPTS = 5;

type Tx = Prisma.TransactionClient;

export function parseDefinition(v: unknown): ProcessDefinition {
  return definitionSchema.parse(v);
}

// ---------- Verteiler ----------

async function activeProcesses(tx: Tx, workspaceId: string) {
  const ps = await tx.process.findMany({ where: { workspaceId, status: "ACTIVE", activeVersionId: { not: null } } });
  const versions = await tx.processVersion.findMany({ where: { id: { in: ps.map((p) => p.activeVersionId!) } } });
  return ps.flatMap((p) => {
    const v = versions.find((x) => x.id === p.activeVersionId);
    if (!v) return [];
    const parsed = definitionSchema.safeParse(v.definition);
    return parsed.success ? [{ process: p, version: v, def: parsed.data }] : [];
  });
}

/** Darf das Objekt (erneut) eingeschrieben werden? */
async function mayEnroll(tx: Tx, processId: string, objectId: string, reenroll: boolean) {
  const existing = await tx.processRun.findFirst({
    where: { processId, objectId, test: false, ...(reenroll ? { status: { in: ["running", "waiting"] } } : {}) },
    select: { id: true },
  });
  return !existing;
}

async function enrollInTx(
  tx: Tx,
  a: { workspaceId: string; processId: string; versionId: string; objectType: string; objectId: string; dedupeKey: string; event?: Record<string, unknown>; eventId?: string; depth: number },
) {
  const dup = await tx.processRun.findUnique({ where: { dedupeKey: a.dedupeKey }, select: { id: true } });
  if (dup) return null;
  const run = await tx.processRun.create({
    data: {
      workspaceId: a.workspaceId,
      processId: a.processId,
      versionId: a.versionId,
      objectType: a.objectType,
      objectId: a.objectId,
      dedupeKey: a.dedupeKey,
      triggerEventId: a.eventId,
      context: { _event: (a.event ?? {}) as Prisma.InputJsonValue, _depth: a.depth } as Prisma.InputJsonValue,
    },
  });
  // Job in derselben Transaktion → kein Lauf ohne Ausführung
  await tx.job.create({ data: { type: "process.step", payload: { runId: run.id } } });
  return run.id;
}

async function handleEvent(tx: Tx, ev: CrmEvent) {
  // Welcher Datensatz wird eingeschrieben? (Beleg-Ereignisse → Kontakt des Belegs)
  const subject = eventSubject(ev);
  if (!subject) {
    log.info("event without enrollable subject", { type: ev.type, objectType: ev.objectType, eventId: String(ev.id) });
    return 0;
  }
  const candidates = (await activeProcesses(tx, ev.workspaceId)).filter(
    (c) => c.process.objectType === subject.objectType && triggerMatches(c.def, ev) && mayTrigger(c.process.id, ev.data).ok,
  );
  if (candidates.length === 0) return 0;
  const loaded = await loadState(ev.workspaceId, subject.objectType as ObjectType, subject.objectId);
  if (!loaded) return 0; // Objekt inzwischen gelöscht
  const data = { ...((ev.data ?? {}) as Record<string, unknown>), ...subject.extra };
  loaded.state.event = data;
  let started = 0;
  for (const c of candidates) {
    if (!evalGroup(loaded.state, c.def.enrollment.filters)) continue;
    if (!(await mayEnroll(tx, c.process.id, subject.objectId, c.def.enrollment.reenroll))) continue;
    const id = await enrollInTx(tx, {
      workspaceId: ev.workspaceId,
      processId: c.process.id,
      versionId: c.version.id,
      objectType: subject.objectType,
      objectId: subject.objectId,
      dedupeKey: `${c.process.id}:${subject.objectId}:${ev.id}`,
      event: { type: ev.type, ...data },
      eventId: String(ev.id),
      depth: eventDepth(data),
    });
    if (id) started++;
  }
  return started;
}

/**
 * Nächstes offenes Ereignis exklusiv holen (exportiert für outbox.db-check.ts).
 * ORDER BY "processedAt", id entspricht dem Index ("processedAt", id): Postgres liest nur die offenen Einträge.
 * Mit ORDER BY id allein lief der Abruf über den Primärschlüssel und filterte die gesamte Historie (LR-2).
 */
export function claimEventQuery() {
  return Prisma.sql`SELECT id FROM "CrmEvent" WHERE "processedAt" IS NULL AND attempts < ${MAX_EVENT_ATTEMPTS}
    ORDER BY "processedAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
}

/** Verteilt bis zu `limit` Ereignisse. Mehrere Worker parallel sind sicher (SKIP LOCKED). */
export async function dispatchEvents(limit = 200): Promise<{ processed: number; started: number; failed: number }> {
  let processed = 0;
  let started = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    let evId: bigint | null = null;
    try {
      const res = await db.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ id: bigint }[]>(claimEventQuery());
          if (rows.length === 0) return null;
          evId = rows[0].id;
          const ev = await tx.crmEvent.findUniqueOrThrow({ where: { id: evId } });
          const n = await handleEvent(tx, ev);
          await tx.crmEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), error: null } });
          return n;
        },
        { timeout: 30_000 },
      );
      if (res === null) break;
      processed++;
      started += res;
    } catch (err) {
      failed++;
      if (evId !== null) {
        // Transaktion ist zurückgerollt → Ereignis bleibt offen, Versuch zählen und Fehler sichtbar machen
        await db.crmEvent
          .update({ where: { id: evId }, data: { attempts: { increment: 1 }, error: String(err instanceof Error ? err.message : err).slice(0, 500) } })
          .catch(() => {});
      } else {
        log.error("dispatcher event error", { error: errMessage(err) });
        break;
      }
    }
  }
  return { processed, started, failed };
}

// ---------- Ausführer ----------

type RunWithVersion = Prisma.ProcessRunGetPayload<{ include: { version: true; process: true } }>;

async function finish(runId: string, status: "done" | "goal_met" | "failed" | "cancelled", error?: string) {
  await db.processRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), error: error ?? null, currentNodeId: status === "done" ? null : undefined } });
}

async function writeLog(tx: Tx, runId: string, node: ProcessNode, status: string, detail: unknown, ms?: number) {
  await tx.processStepLog.create({ data: { runId, nodeId: node.id, nodeType: node.type, status, detail: (detail ?? undefined) as Prisma.InputJsonValue, ms } });
}

function context(run: RunWithVersion) {
  return { ...((run.context as Record<string, unknown>) ?? {}) };
}

/** Logik-Knoten (ohne Datenänderung). Liefert Ausgang oder Warten. */
function planLogic(node: ProcessNode, run: RunWithVersion, state: Parameters<typeof evalGroup>[0]): { output?: string; waitUntil?: Date; detail?: Record<string, unknown>; contextPatch?: Record<string, unknown> } {
  const ctx = context(run);
  const cfg = node.config as Record<string, unknown>;
  const now = new Date();
  switch (node.type) {
    case "logic.end":
      return { output: "end" };
    case "logic.if": {
      const ok = evalGroup(state, cfg as never);
      return { output: ok ? "yes" : "no", detail: { result: ok } };
    }
    case "logic.wait": {
      const ms = Number(cfg.amount) * (cfg.unit === "minutes" ? 60e3 : cfg.unit === "hours" ? 3600e3 : 864e5);
      if (run.test) return { output: "next", detail: { test: true, wouldWait: `${String(cfg.amount)} ${String(cfg.unit)}` } };
      const waits = { ...((ctx._wait as Record<string, string>) ?? {}) };
      if (!waits[node.id]) {
        const until = new Date(now.getTime() + ms);
        waits[node.id] = until.toISOString();
        return { waitUntil: until, contextPatch: { _wait: waits } };
      }
      const until = new Date(waits[node.id]);
      return until <= now ? { output: "next", detail: { waitedUntil: waits[node.id] } } : { waitUntil: until };
    }
    case "logic.wait_until": {
      const until = cfg.until as never;
      if (evalGroup(state, until)) return { output: "met" };
      if (run.test) return { output: "timeout", detail: { test: true, note: "Bedingung derzeit nicht erfüllt" } };
      const starts = { ...((ctx._waitStart as Record<string, string>) ?? {}) };
      if (!starts[node.id]) starts[node.id] = now.toISOString();
      const deadline = new Date(new Date(starts[node.id]).getTime() + Number(cfg.timeoutDays) * 864e5);
      if (deadline <= now) return { output: "timeout" };
      return { waitUntil: new Date(Math.min(deadline.getTime(), now.getTime() + WAIT_UNTIL_RECHECK_MS)), contextPatch: { _waitStart: starts } };
    }
    default:
      throw new Error(`Kein Logik-Knoten: ${node.type}`);
  }
}

/**
 * Führt einen Lauf so weit wie möglich aus. Wirft bei Fehlern ohne Fehler-Kante → Job-Wiederholung
 * mit Backoff (der Knoten wird wiederholt, Datenänderungen waren zurückgerollt).
 */
export async function runProcessStep(runId: string): Promise<void> {
  for (let i = 0; i < MAX_STEPS_PER_JOB; i++) {
    const run = await db.processRun.findUnique({ where: { id: runId }, include: { version: true, process: true } });
    if (!run || FINAL.includes(run.status)) return;
    const ctx = context(run);

    if (!run.test) {
      if (run.process.status === "ARCHIVED") return finish(run.id, "cancelled", "Prozess wurde archiviert");
      if (run.process.status === "PAUSED" || run.process.status === "DRAFT") {
        await db.processRun.update({ where: { id: run.id }, data: { status: "waiting", context: { ...ctx, _paused: true } as Prisma.InputJsonValue } });
        return;
      }
    }

    const def = parseDefinition(run.version.definition);
    const node = findNode(def, run.currentNodeId ?? def.start);
    if (!node) return finish(run.id, "done");

    const loaded = await loadState(run.workspaceId, run.objectType as ObjectType, run.objectId);
    if (!loaded) return finish(run.id, "cancelled", "Datensatz existiert nicht mehr");
    loaded.state.event = (ctx._event as Record<string, unknown>) ?? {};
    loaded.state.context = ctx;

    if (def.goal && evalGroup(loaded.state, def.goal)) {
      await db.$transaction(async (tx) => writeLog(tx, run.id, node, "skipped", { goalMet: true }));
      return finish(run.id, "goal_met");
    }

    // Idempotenz: Schritt schon erledigt (Absturz nach Protokoll)? → mit protokolliertem Ausgang weiter
    const done = await db.processStepLog.findFirst({ where: { runId: run.id, nodeId: node.id, status: { in: ["ok", "branch", "skipped", "running"] } }, orderBy: { createdAt: "desc" } });
    if (done?.status === "running") {
      // Außenwirkung war gestartet, Ergebnis unbekannt → nicht wiederholen (höchstens einmal)
      const msg = "Unklarer Zustand nach Abbruch während einer Außenwirkung – nicht wiederholt.";
      await db.$transaction(async (tx) => writeLog(tx, run.id, node, "failed", { error: msg }));
      const errNext = nextNodeId(def, node.id, "error");
      if (!errNext) return finish(run.id, "failed", msg);
      await db.processRun.update({ where: { id: run.id }, data: { currentNodeId: errNext, status: "running" } });
      continue;
    }
    if (done) {
      const out = String((done.detail as Record<string, unknown> | null)?._output ?? "next");
      const next = nextNodeId(def, node.id, out);
      await db.processRun.update({ where: { id: run.id }, data: next ? { currentNodeId: next, status: "running" } : { status: "done", finishedAt: new Date(), currentNodeId: null } });
      if (!next) return;
      continue;
    }

    const started = Date.now();
    try {
      let plan: Plan;
      if (node.type.startsWith("logic.")) {
        const l = planLogic(node, run, loaded.state);
        if (l.waitUntil) {
          await db.$transaction(async (tx) => {
            await writeLog(tx, run.id, node, "waiting", { until: l.waitUntil!.toISOString() });
            await tx.processRun.update({ where: { id: run.id }, data: { status: "waiting", context: { ...ctx, ...(l.contextPatch ?? {}) } as Prisma.InputJsonValue } });
            await tx.job.create({ data: { type: "process.step", payload: { runId: run.id }, runAt: l.waitUntil! } });
          });
          return;
        }
        plan = { output: l.output!, detail: l.detail, contextPatch: l.contextPatch };
      } else {
        plan = await planNode(node, {
          workspaceId: run.workspaceId,
          processId: run.processId,
          processName: run.process.name,
          runId: run.id,
          test: run.test,
          depth: Number(ctx._depth ?? 0),
          objectType: run.objectType as ObjectType,
          objectId: run.objectId,
          versionApproved: !run.version.external || !!run.version.approvedAt,
          loaded,
        });
      }

      // Außenwirkung: erst Marker, dann ausführen, dann Ergebnis protokollieren
      let outboundDetail: Record<string, unknown> | undefined;
      // Wiederholbare Nebenwirkung ohne Außenwirkung (z. B. Beleg erzeugen; idempotent über Vorab-Prüfung):
      // eigene Transaktion, Ergebnis kann den Kontext ergänzen; kein „running“-Marker nötig
      if (plan.sideEffect && !run.test) {
        const r = await plan.sideEffect();
        outboundDetail = { ...(outboundDetail ?? {}), ...(r.detail ?? {}) };
        if (r.context) plan.contextPatch = { ...(plan.contextPatch ?? {}), ...r.context };
      }
      if (plan.outbound && !run.test) {
        await db.$transaction(async (tx) => writeLog(tx, run.id, node, "running", null));
        try {
          outboundDetail = await plan.outbound();
        } catch (e) {
          // Eindeutig fehlgeschlagen (nichts versendet) → Marker entfernen, damit eine Wiederholung erlaubt ist
          await db.processStepLog.deleteMany({ where: { runId: run.id, nodeId: node.id, status: "running" } });
          throw e;
        }
      }

      const next = plan.output === "end" ? null : nextNodeId(def, node.id, plan.output);
      await db.$transaction(
        async (tx) => {
          if (plan.apply && !run.test) await plan.apply(tx);
          if (plan.outbound) await tx.processStepLog.deleteMany({ where: { runId: run.id, nodeId: node.id, status: "running" } });
          const status = node.type === "logic.if" || node.type === "logic.wait_until" ? "branch" : plan.detail?.skipped ? "skipped" : "ok";
          await writeLog(tx, run.id, node, status, { ...(plan.detail ?? {}), ...(outboundDetail ?? {}), _output: plan.output }, Date.now() - started);
          await tx.processRun.update({
            where: { id: run.id },
            data: {
              currentNodeId: next,
              context: { ...ctx, ...(plan.contextPatch ?? {}) } as Prisma.InputJsonValue,
              status: next ? "running" : "done",
              finishedAt: next ? null : new Date(),
              error: null,
            },
          });
        },
        { timeout: 30_000 },
      );
      if (!next) return;
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
      if (hasErrorEdge(def, node.id)) {
        const errNext = nextNodeId(def, node.id, "error")!;
        await db.$transaction(async (tx) => {
          await writeLog(tx, run.id, node, "failed", { error: msg, _output: "error" }, Date.now() - started);
          await tx.processRun.update({ where: { id: run.id }, data: { currentNodeId: errNext, status: "running", error: msg } });
        });
        continue;
      }
      await db.processRun.update({ where: { id: run.id }, data: { error: msg } }).catch(() => {});
      throw err;
    }
  }
  // Sehr lange Abläufe in Etappen weiterführen
  await enqueue("process.step", { runId });
}

/** Endgültig gescheiterter Job → Lauf als fehlgeschlagen markieren. */
export async function markRunFailed(runId: string, error: string) {
  await db.processRun.updateMany({ where: { id: runId, status: { notIn: FINAL } }, data: { status: "failed", error: error.slice(0, 500), finishedAt: new Date() } });
}

/** Nach Reaktivieren: angehaltene Läufe fortsetzen. */
export async function resumePausedRuns(processId: string) {
  const runs = await db.processRun.findMany({ where: { processId, status: "waiting" } });
  for (const r of runs) {
    const ctx = (r.context as Record<string, unknown>) ?? {};
    if (!ctx._paused) continue;
    delete ctx._paused;
    await db.processRun.update({ where: { id: r.id }, data: { status: "running", context: ctx as Prisma.InputJsonValue } });
    await enqueue("process.step", { runId: r.id });
  }
}

/** Beim Archivieren: offene Läufe abbrechen. */
export async function cancelOpenRuns(processId: string) {
  await db.processRun.updateMany({ where: { processId, status: { in: ["running", "waiting"] } }, data: { status: "cancelled", finishedAt: new Date(), error: "Prozess wurde archiviert" } });
}

// ---------- Zeitbasierte Prozesse ----------

const DAILY_COOLDOWN_DAYS = 7;
const DAILY_MAX_OBJECTS = 2000;

async function objectIds(workspaceId: string, objectType: ObjectType): Promise<string[]> {
  const args = { where: { workspaceId }, select: { id: true }, orderBy: { updatedAt: "asc" as const }, take: DAILY_MAX_OBJECTS };
  if (objectType === "contact") return (await db.contact.findMany(args)).map((x) => x.id);
  if (objectType === "company") return (await db.company.findMany(args)).map((x) => x.id);
  if (objectType === "deal") return (await db.deal.findMany(args)).map((x) => x.id);
  return (await db.ticket.findMany(args)).map((x) => x.id);
}

/**
 * Täglicher Lauf: prüft für Prozesse mit Auslöser „schedule.daily“ alle Objekte (bis 2000) gegen die Filter.
 * Ein Objekt wird höchstens alle 7 Tage erneut eingeschrieben (verhindert tägliche Wiederholungsaufgaben).
 */
export async function scheduleDaily(now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const processes = await db.process.findMany({ where: { status: "ACTIVE", activeVersionId: { not: null } } });
  let started = 0;
  for (const p of processes) {
    const v = await db.processVersion.findUnique({ where: { id: p.activeVersionId! } });
    const parsed = v ? definitionSchema.safeParse(v.definition) : null;
    if (!v || !parsed?.success || parsed.data.trigger.type !== "schedule.daily") continue;
    const def = parsed.data;
    if (!(OBJECT_TYPES as readonly string[]).includes(p.objectType)) continue;
    for (const oid of await objectIds(p.workspaceId, p.objectType as ObjectType)) {
      const recent = await db.processRun.findFirst({
        where: { processId: p.id, objectId: oid, test: false, startedAt: { gte: new Date(now.getTime() - DAILY_COOLDOWN_DAYS * 864e5) } },
        select: { id: true },
      });
      if (recent) continue;
      const loaded = await loadState(p.workspaceId, p.objectType as ObjectType, oid);
      if (!loaded || !evalGroup(loaded.state, def.enrollment.filters, now)) continue;
      const id = await db.$transaction(async (tx) => {
        if (!(await mayEnroll(tx, p.id, oid, def.enrollment.reenroll))) return null;
        return enrollInTx(tx, { workspaceId: p.workspaceId, processId: p.id, versionId: v.id, objectType: p.objectType, objectId: oid, dedupeKey: `${p.id}:${oid}:daily:${day}`, event: { type: "schedule.daily", day }, depth: 0 });
      });
      if (id) started++;
    }
  }
  return started;
}

/** Für Bericht/Tests: welche Auslöser zu welchem Objekttyp passen. */
export function triggerObjectType(type: keyof typeof TRIGGER_TYPES) {
  return TRIGGER_TYPES[type].objectType;
}

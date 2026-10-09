"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, can, type Access } from "@/lib/permissions";
import { guard, withScope } from "@/lib/permissions/guard";
import type { Need } from "@/lib/permissions/areas";
import { definitionSchema, emptyDefinition, OBJECT_TYPES, TRIGGER_TYPES, type ObjectType, type ProcessDefinition, type TriggerType } from "@/lib/process/definition";
import { createProcess, enrollObject, getRun, publishProcess, saveDraft, setProcessStatus } from "@/lib/process/api";
import type { ActionResult, RunView } from "@/components/process/types";

export type FormState = { error?: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

async function ctx(slug: string, need: Need = { object: "processes", action: "edit" }) {
  const { ws, user, access } = await guard(slug, need);
  return { ws, access, actor: `user:${user.id}` };
}

const READ: Need = { object: "processes", action: "read" };

/** Datensatz für Testlauf/Einschreibung muss in der eigenen Lese-Reichweite liegen. */
async function assertObjectReadable(access: Access, workspaceId: string, objectType: string, objectId: string) {
  const id = String(objectId).slice(0, 60);
  const row =
    objectType === "contact" ? await db.contact.findFirst({ where: { id, workspaceId }, select: { ownerId: true } })
    : objectType === "company" ? await db.company.findFirst({ where: { id, workspaceId }, select: { ownerId: true } })
    : objectType === "deal" ? await db.deal.findFirst({ where: { id, workspaceId }, select: { ownerId: true } })
    : objectType === "ticket" ? await db.ticket.findFirst({ where: { id, workspaceId }, select: { ownerId: true } })
    : null;
  const obj = ({ contact: "contacts", company: "companies", deal: "deals", ticket: "tickets" } as const)[objectType as "contact"];
  if (!row || !obj || !can(access, obj, "read", row.ownerId)) throw new ForbiddenError("Datensatz nicht gefunden oder keine Berechtigung.");
}

/** Prüft, dass der Prozess zu diesem Sub-Account gehört. */
async function ownProcess(workspaceId: string, processId: string) {
  const p = await db.process.findFirst({ where: { id: processId, workspaceId }, select: { id: true, objectType: true } });
  if (!p) throw new Error("Prozess nicht gefunden.");
  return p;
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Name zu kurz").max(120),
  objectType: z.enum(OBJECT_TYPES),
  trigger: z.enum(Object.keys(TRIGGER_TYPES) as [TriggerType, ...TriggerType[]]),
});

export async function createEmptyProcess(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  let c;
  try {
    c = await ctx(slug);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  const { ws, actor } = c;
  const p = createSchema.safeParse({ name: fd.get("name"), objectType: fd.get("objectType"), trigger: fd.get("trigger") });
  if (!p.success) return { error: p.error.issues[0].message };
  const t = TRIGGER_TYPES[p.data.trigger];
  if (t.objectType && t.objectType !== p.data.objectType) return { error: "Der Auslöser passt nicht zum gewählten Objekt." };
  let id: string;
  try {
    ({ id } = await createProcess(ws.id, { name: p.data.name, objectType: p.data.objectType, definition: emptyDefinition(p.data.trigger) }, actor));
  } catch (e) {
    return { error: msg(e) };
  }
  redirect(`/sa/${slug}/prozesse/${id}`);
}

export async function createFromTemplate(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  let c;
  try {
    c = await ctx(slug);
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  const { ws, actor } = c;
  const p = z
    .object({ templateKey: z.string().trim().min(1).max(80), name: z.string().trim().min(2).max(120), objectType: z.enum(OBJECT_TYPES) })
    .safeParse({ templateKey: fd.get("templateKey"), name: fd.get("name"), objectType: fd.get("objectType") });
  if (!p.success) return { error: "Vorlage ungültig." };
  let id: string;
  try {
    ({ id } = await createProcess(ws.id, { name: p.data.name, objectType: p.data.objectType as ObjectType, templateKey: p.data.templateKey }, actor));
  } catch (e) {
    return { error: msg(e) };
  }
  redirect(`/sa/${slug}/prozesse/${id}`);
}

export async function saveDraftAction(slug: string, processId: string, definition: unknown): Promise<ActionResult<{ version: number; ok: boolean }>> {
  try {
    const { ws, actor } = await ctx(slug);
    await ownProcess(ws.id, processId);
    const parsed = definitionSchema.safeParse(definition);
    if (!parsed.success) return { ok: false, error: `Entwurf ist unvollständig: ${parsed.error.issues[0].path.join(".")} – ${parsed.error.issues[0].message}` };
    const r = await saveDraft(ws.id, processId, parsed.data as ProcessDefinition, actor);
    revalidatePath(`/sa/${slug}/prozesse`);
    return { ok: true, data: { version: r.version, ok: r.validation.ok }, message: r.validation.ok ? `Entwurf gespeichert (Version ${r.version}).` : `Gespeichert (Version ${r.version}), aber noch nicht veröffentlichbar.` };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function publishAction(slug: string, processId: string): Promise<ActionResult<{ status: string }>> {
  try {
    const { ws, actor } = await ctx(slug);
    await ownProcess(ws.id, processId);
    const r = await publishProcess(ws.id, processId, actor);
    revalidatePath(`/sa/${slug}/prozesse`);
    if (!r.validation.ok) return { ok: false, error: "Der Entwurf hat noch Fehler. Bitte zuerst beheben." };
    return {
      ok: true,
      data: { status: r.status },
      message: r.status === "published" ? "Veröffentlicht. Neue Ereignisse laufen ab jetzt durch diese Version." : "Freigabe angefragt: Der Prozess enthält Aktionen mit Außenwirkung und startet nach Zustimmung im Freigabe-Eingang.",
    };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function statusAction(slug: string, processId: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED"): Promise<ActionResult<null>> {
  try {
    if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) throw new Error("Ungültiger Status.");
    const { ws, actor } = await ctx(
      slug,
      status === "ARCHIVED" ? { object: "processes", action: "delete" } : status === "ACTIVE" ? { special: "publish_processes" } : { object: "processes", action: "edit" },
    );
    await ownProcess(ws.id, processId);
    await setProcessStatus(ws.id, processId, status, actor);
    revalidatePath(`/sa/${slug}/prozesse`);
    return { ok: true, data: null, message: { ACTIVE: "Prozess ist aktiv.", PAUSED: "Prozess pausiert. Laufende Durchläufe warten.", ARCHIVED: "Prozess archiviert." }[status] };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Objekte für den Testlauf suchen (nur dieser Sub-Account). */
export async function searchObjectsAction(slug: string, objectType: string, q: string): Promise<ActionResult<{ id: string; label: string }[]>> {
  try {
    const { ws, access } = await ctx(slug, READ);
    const term = String(q ?? "").trim().slice(0, 100);
    const ci = { contains: term, mode: "insensitive" as const };
    const take = 10;
    let rows: { id: string; label: string }[] = [];
    if (objectType === "contact") {
      const r = await db.contact.findMany({
        where: withScope({ workspaceId: ws.id, ...(term ? { OR: [{ email: ci }, { firstName: ci }, { lastName: ci }, { company: ci }] } : {}) }, access, "contacts"),
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      rows = r.map((c) => ({ id: c.id, label: [[c.firstName, c.lastName].filter(Boolean).join(" "), c.email].filter(Boolean).join(" · ") || c.id }));
    } else if (objectType === "company") {
      const r = await db.company.findMany({ where: withScope({ workspaceId: ws.id, ...(term ? { OR: [{ name: ci }, { domain: ci }] } : {}) }, access, "companies"), orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, domain: true } });
      rows = r.map((c) => ({ id: c.id, label: [c.name, c.domain].filter(Boolean).join(" · ") }));
    } else if (objectType === "deal") {
      const r = await db.deal.findMany({ where: withScope({ workspaceId: ws.id, ...(term ? { title: ci } : {}) }, access, "deals"), orderBy: { createdAt: "desc" }, take, select: { id: true, title: true } });
      rows = r.map((d) => ({ id: d.id, label: d.title }));
    } else if (objectType === "ticket") {
      const r = await db.ticket.findMany({ where: withScope({ workspaceId: ws.id, ...(term ? { subject: ci } : {}) }, access, "tickets"), orderBy: { createdAt: "desc" }, take, select: { id: true, subject: true, numericId: true } });
      rows = r.map((t) => ({ id: t.id, label: `#${t.numericId} ${t.subject}` }));
    } else throw new Error("Unbekannter Objekttyp.");
    return { ok: true, data: rows };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Testlauf: schreibt ein Objekt im Testmodus ein (ohne Außenwirkung). */
export async function testRunAction(slug: string, processId: string, objectId: string): Promise<ActionResult<{ runId: string }>> {
  try {
    const { ws, actor, access } = await ctx(slug);
    const p = await ownProcess(ws.id, processId);
    await assertObjectReadable(access, ws.id, p.objectType, objectId);
    const r = await enrollObject(ws.id, processId, String(objectId).slice(0, 60), { actor, test: true });
    return { ok: true, data: r, message: "Testlauf gestartet." };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** Manuelles Einschreiben (echter Lauf). */
export async function enrollAction(slug: string, processId: string, objectId: string): Promise<ActionResult<{ runId: string }>> {
  try {
    const { ws, actor, access } = await ctx(slug, { special: "publish_processes" });
    const p = await ownProcess(ws.id, processId);
    await assertObjectReadable(access, ws.id, p.objectType, objectId);
    const r = await enrollObject(ws.id, processId, String(objectId).slice(0, 60), { actor });
    return { ok: true, data: r, message: "Datensatz eingeschrieben." };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function getRunAction(slug: string, runId: string): Promise<ActionResult<RunView>> {
  try {
    const { ws } = await ctx(slug, READ);
    const r = await getRun(ws.id, String(runId).slice(0, 60));
    return { ok: true, data: { ...r, steps: r.steps.map((s) => ({ ...s, createdAt: new Date(s.createdAt).toISOString() })) } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

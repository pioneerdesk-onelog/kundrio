"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { assertRecord, forbiddenToState, guard } from "@/lib/permissions/guard";
import { ForbiddenError } from "@/lib/permissions";

export type ResearchState = { error?: string; jobId?: string; ok?: string };

const objSchema = z.object({ objectType: z.enum(["company", "contact"]), objectId: z.string().min(1).max(60) });

/** „Jetzt recherchieren“: Auftrag an den Worker. Recht: Unternehmen (bzw. Kontakte) bearbeiten + Reichweite. */
export async function startResearch(slug: string, objectType: string, objectId: string): Promise<ResearchState> {
  try {
    const o = objSchema.parse({ objectType, objectId });
    const object = o.objectType === "company" ? "companies" : "contacts";
    const { ws, access, user } = await guard(slug, { object, action: "edit" });
    const rec =
      o.objectType === "company"
        ? await db.company.findFirst({ where: { id: o.objectId, workspaceId: ws.id }, select: { ownerId: true } })
        : await db.contact.findFirst({ where: { id: o.objectId, workspaceId: ws.id }, select: { ownerId: true } });
    if (!rec) return { error: "Datensatz nicht gefunden." };
    assertRecord(access, object, "edit", rec.ownerId);
    if (o.objectType === "contact" && !ws.enrichPersons) {
      return { error: "Recherche zu Personen ist in diesem Sub-Account nicht freigeschaltet (nur beruflich, Einstellungen → Anreicherung)." };
    }
    // Kein zweiter Auftrag für denselben Datensatz, solange einer wartet/läuft
    const running = await db.job.findFirst({
      where: { type: "research.run", status: { in: ["queued", "running"] }, payload: { path: ["objectId"], equals: o.objectId } },
      select: { id: true },
    });
    if (running) return { jobId: running.id, ok: "Recherche läuft bereits." };
    const job = await enqueue("research.run", { workspaceId: ws.id, objectType: o.objectType, objectId: o.objectId });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "research.started", target: o.objectId, detail: { objectType: o.objectType } });
    return { jobId: job.id, ok: "Recherche gestartet." };
  } catch (e) {
    return forbiddenToState(e) ?? { error: e instanceof Error ? e.message : "Unbekannter Fehler" };
  }
}

/** Status eines Recherche-Auftrags (nur eigener Sub-Account). */
export async function researchStatus(slug: string, jobId: string): Promise<{ status: string; error?: string | null }> {
  const { ws } = await guard(slug, { object: "companies", action: "read" });
  const job = await db.job.findFirst({ where: { id: jobId, type: "research.run", payload: { path: ["workspaceId"], equals: ws.id } }, select: { status: true, lastError: true } });
  if (!job) return { status: "unbekannt" };
  return { status: job.status, error: job.lastError };
}

/** Treffer als relevant/irrelevant/neu markieren. */
export async function markMention(slug: string, mentionId: string, status: string): Promise<ResearchState> {
  try {
    const s = z.enum(["new", "relevant", "irrelevant"]).parse(status);
    const { ws, access } = await guard(slug, { object: "companies", action: "edit" });
    const m = await db.mention.findFirst({ where: { id: mentionId, workspaceId: ws.id }, include: { company: { select: { ownerId: true } }, contact: { select: { ownerId: true } } } });
    if (!m) return { error: "Erwähnung nicht gefunden." };
    if (m.company) assertRecord(access, "companies", "edit", m.company.ownerId);
    else if (m.contact) assertRecord(access, "contacts", "edit", m.contact.ownerId);
    else throw new ForbiddenError();
    await db.mention.update({ where: { id: m.id }, data: { status: s } });
    revalidatePath(`/sa/${slug}/erwaehnungen`);
    return { ok: "Gespeichert." };
  } catch (e) {
    return forbiddenToState(e) ?? { error: e instanceof Error ? e.message : "Unbekannter Fehler" };
  }
}

/** Monitoring ein/aus (Einstellung des Sub-Accounts). */
export async function setMonitoring(slug: string, _prev: ResearchState, fd: FormData): Promise<ResearchState> {
  try {
    const { ws, user } = await guard(slug, { special: "manage_settings" });
    const enabled = fd.get("enabled") === "on";
    await db.workspace.update({ where: { id: ws.id }, data: { mentionMonitoring: enabled } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "research.monitoring", detail: { enabled } });
    revalidatePath(`/sa/${slug}/erwaehnungen`);
    return { ok: enabled ? "Monitoring aktiviert – wöchentlicher Lauf montags." : "Monitoring deaktiviert." };
  } catch (e) {
    return forbiddenToState(e) ?? { error: e instanceof Error ? e.message : "Unbekannter Fehler" };
  }
}

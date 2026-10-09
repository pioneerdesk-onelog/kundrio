"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { assertRecord, guard } from "@/lib/permissions/guard";

const dateOpt = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Ungültiges Datum" });
      return z.NEVER;
    }
    return d;
  });

export async function createTask(slug: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "tasks", action: "edit" });
  const data = z
    .object({
      title: z.string().trim().min(1, "Titel fehlt").max(300),
      dueAt: dateOpt,
      contactId: z.string().optional().transform((v) => v || null),
    })
    .parse({ title: fd.get("title"), dueAt: fd.get("dueAt") || undefined, contactId: fd.get("contactId") || undefined });

  if (data.contactId) {
    const ok = await db.contact.findFirst({ where: { id: data.contactId, workspaceId: ws.id }, select: { id: true, ownerId: true } });
    if (!ok || !can(access, "contacts", "read", ok.ownerId)) throw new Error("Kontakt nicht gefunden");
  }
  // Neue Aufgaben gehören dem Anlegenden (Reichweite „eigene“ bleibt so erhalten)
  await db.task.create({ data: { ...data, workspaceId: ws.id, ownerId: access.userId } });
  if (data.contactId) {
    await db.activity.create({ data: { workspaceId: ws.id, contactId: data.contactId, type: "TASK", body: `Aufgabe angelegt: ${data.title}` } });
  }
  revalidatePath(`/sa/${slug}/aufgaben`);
}

export async function toggleTask(slug: string, taskId: string) {
  const { ws, access } = await guard(slug, { object: "tasks", action: "edit" });
  const task = await db.task.findFirst({ where: { id: taskId, workspaceId: ws.id } });
  if (!task) throw new Error("Aufgabe nicht gefunden");
  assertRecord(access, "tasks", "edit", task.ownerId);
  const doneAt = task.doneAt ? null : new Date();
  await db.task.update({ where: { id: task.id }, data: { doneAt } });
  if (doneAt && task.contactId) {
    await db.activity.create({ data: { workspaceId: ws.id, contactId: task.contactId, type: "TASK", body: `Aufgabe erledigt: ${task.title}` } });
  }
  revalidatePath(`/sa/${slug}/aufgaben`);
}

export async function deleteTask(slug: string, taskId: string) {
  const { ws, access } = await guard(slug, { object: "tasks", action: "delete" });
  const task = await db.task.findFirst({ where: { id: taskId, workspaceId: ws.id }, select: { ownerId: true } });
  if (!task) return;
  assertRecord(access, "tasks", "delete", task.ownerId);
  await db.task.deleteMany({ where: { id: taskId, workspaceId: ws.id } });
  revalidatePath(`/sa/${slug}/aufgaben`);
}

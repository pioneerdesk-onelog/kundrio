"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { guard, guardOrRedirect, recordOrRedirect } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import type { Access } from "@/lib/permissions";
import { isValidOwner } from "@/lib/objects/defaults";
import { PRIORITIES } from "@/lib/objects/lifecycle";
import { createTicket as createTicketRecord, moveTicket as moveTicketRecord } from "@/lib/objects/tickets";

const q = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const optId = z.string().max(60).optional().transform((v) => v || null);

async function ticketOwner(workspaceId: string, ticketId: string) {
  return (await db.ticket.findFirst({ where: { id: ticketId, workspaceId }, select: { ownerId: true } }))?.ownerId ?? null;
}

function checkOwner(access: Access, ownerId: string | null) {
  if (!canSetOwner(access.perms, "tickets", { userId: access.userId, teamUserIds: access.teamUserIds }, ownerId)) {
    throw new Error("Diese Person dürfen Sie nicht als Zuständige eintragen.");
  }
}

const schema = z.object({
  subject: z.string().trim().min(1, "Betreff fehlt").max(300),
  description: z.string().trim().max(20_000).optional().transform((v) => v || null),
  priority: z.enum(PRIORITIES),
  contactId: optId,
  companyId: optId,
  ownerId: optId,
});

export async function createTicket(slug: string, fd: FormData) {
  const { ws, access } = await guardOrRedirect(slug, { object: "tickets", action: "edit" }, `/sa/${slug}/tickets`);
  let id: string;
  try {
    const d = schema.parse({
      subject: fd.get("subject"), description: fd.get("description") ?? undefined, priority: fd.get("priority") ?? "medium",
      contactId: fd.get("contactId") ?? undefined, companyId: fd.get("companyId") ?? undefined, ownerId: fd.get("ownerId") ?? undefined,
    });
    if (d.ownerId && !(await isValidOwner(ws.id, d.ownerId))) throw new Error("Zuständige Person ist nicht berechtigt");
    if (!d.ownerId && access.perms.objects.tickets.edit !== "all") d.ownerId = access.userId;
    checkOwner(access, d.ownerId);
    const t = await createTicketRecord(ws.id, { ...d, source: "manual" });
    id = t.id;
  } catch (e) {
    redirect(`/sa/${slug}/tickets?fehler=${q(msg(e))}`);
  }
  redirect(`/sa/${slug}/tickets/${id}?ok=${q("Ticket angelegt")}`);
}

/** Für das Kanban (wirft bei Fehlern → Karte springt zurück). */
export async function moveTicket(slug: string, ticketId: string, stageId: string): Promise<void | { error: string }> {
  let ctx;
  try {
    ctx = await guard(slug, { object: "tickets", action: "edit" });
  } catch {
    return { error: "Keine Berechtigung, Tickets zu verschieben." };
  }
  const { ws, access } = ctx;
  if (!can(access, "tickets", "edit", await ticketOwner(ws.id, ticketId))) return { error: "Keine Berechtigung für dieses Ticket." };
  await moveTicketRecord(ws.id, ticketId, stageId);
  revalidatePath(`/sa/${slug}/tickets`);
}

export async function changeTicketStage(slug: string, ticketId: string, fd: FormData) {
  const back = `/sa/${slug}/tickets/${ticketId}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "tickets", action: "edit" }, back);
  recordOrRedirect(access, "tickets", "edit", await ticketOwner(ws.id, ticketId), back);
  try {
    await moveTicketRecord(ws.id, ticketId, String(fd.get("stageId") ?? ""));
  } catch (e) {
    redirect(`${back}?fehler=${q(msg(e))}`);
  }
  redirect(`${back}?ok=${q("Status geändert")}`);
}

export async function updateTicket(slug: string, ticketId: string, fd: FormData) {
  const back = `/sa/${slug}/tickets/${ticketId}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "tickets", action: "edit" }, back);
  const currentOwner = await ticketOwner(ws.id, ticketId);
  recordOrRedirect(access, "tickets", "edit", currentOwner, back);
  try {
    const d = schema.parse({
      subject: fd.get("subject"), description: fd.get("description") ?? undefined, priority: fd.get("priority") ?? "medium",
      contactId: fd.get("contactId") ?? undefined, companyId: fd.get("companyId") ?? undefined, ownerId: fd.get("ownerId") ?? undefined,
    });
    if (d.ownerId && !(await isValidOwner(ws.id, d.ownerId))) throw new Error("Zuständige Person ist nicht berechtigt");
    if (d.ownerId !== currentOwner) checkOwner(access, d.ownerId);
    if (d.contactId && !(await db.contact.findFirst({ where: { id: d.contactId, workspaceId: ws.id }, select: { id: true } }))) throw new Error("Kontakt nicht gefunden");
    if (d.companyId && !(await db.company.findFirst({ where: { id: d.companyId, workspaceId: ws.id }, select: { id: true } }))) throw new Error("Unternehmen nicht gefunden");
    const r = await db.ticket.updateMany({ where: { id: ticketId, workspaceId: ws.id }, data: d });
    if (r.count === 0) throw new Error("Ticket nicht gefunden");
  } catch (e) {
    redirect(`${back}?fehler=${q(msg(e))}`);
  }
  redirect(`${back}?ok=${q("Gespeichert")}`);
}

export async function addTicketNote(slug: string, ticketId: string, fd: FormData) {
  const back = `/sa/${slug}/tickets/${ticketId}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "tickets", action: "edit" }, back);
  const body = z.string().trim().min(1).max(5000).safeParse(fd.get("body"));
  if (!body.success) redirect(`${back}?fehler=${q("Notiz ist leer")}`);
  const t = await db.ticket.findFirst({ where: { id: ticketId, workspaceId: ws.id } });
  if (!t) redirect(`${back}?fehler=${q("Ticket nicht gefunden")}`);
  recordOrRedirect(access, "tickets", "edit", t.ownerId, back);
  await db.$transaction([
    db.activity.create({ data: { workspaceId: ws.id, contactId: t.contactId, type: "NOTE", body: `Ticket #${t.numericId}: ${body.data}`, meta: { ticketId: t.id } } }),
    // Erste Reaktion zählt auch eine Notiz
    db.ticket.update({ where: { id: t.id }, data: { firstResponseAt: t.firstResponseAt ?? new Date() } }),
  ]);
  redirect(`${back}?ok=${q("Notiz gespeichert")}`);
}

export async function deleteTicket(slug: string, ticketId: string) {
  const back = `/sa/${slug}/tickets/${ticketId}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "tickets", action: "delete" }, back);
  recordOrRedirect(access, "tickets", "delete", await ticketOwner(ws.id, ticketId), back);
  await db.ticket.deleteMany({ where: { id: ticketId, workspaceId: ws.id } });
  redirect(`/sa/${slug}/tickets?ok=${q("Ticket gelöscht")}`);
}

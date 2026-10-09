"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard, forbiddenToState } from "@/lib/permissions/guard";
import { can } from "@/lib/permissions";
import { storeFile } from "@/lib/storage";
import { createTicket } from "@/lib/objects/tickets";
import { audit } from "@/lib/audit";
import { addNote, replyToConversation } from "@/lib/inbox/send";
import { draftReply } from "@/lib/inbox/ai";

export type InboxActionState = { error?: string; ok?: string; draft?: string };

const EDIT = { object: "email" as const, action: "edit" as const };
const MAX_ATTACH = 900 * 1024; // Server Actions nehmen standardmäßig max. 1 MB an

async function ownConversation(workspaceId: string, id: string) {
  const c = await db.conversation.findFirst({ where: { id, workspaceId }, select: { id: true, contactId: true, subject: true, ticketId: true, inboxId: true, tags: true } });
  if (!c) throw new Error("Gespräch nicht gefunden");
  return c;
}

function err(e: unknown): InboxActionState {
  return forbiddenToState(e) ?? { error: e instanceof Error ? e.message : "Unbekannter Fehler" };
}

export async function replyAction(slug: string, conversationId: string, _prev: InboxActionState, fd: FormData): Promise<InboxActionState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    await ownConversation(ws.id, conversationId);
    const text = String(fd.get("text") ?? "");
    const cc = String(fd.get("cc") ?? "").split(/[,;\s]+/).filter(Boolean);
    const fileIds: string[] = [];
    for (const f of fd.getAll("attachments")) {
      if (!(f instanceof File) || f.size === 0) continue;
      if (f.size > MAX_ATTACH) return { error: `„${f.name}“ ist zu groß (max. 900 KB über dieses Formular).` };
      const { file } = await storeFile({ workspaceId: ws.id, kind: "document", name: f.name, data: new Uint8Array(await f.arrayBuffer()), createdBy: user.id });
      fileIds.push(file.id);
    }
    await replyToConversation(ws.id, conversationId, user.id, { text, cc, fileIds });
    revalidatePath(`/sa/${slug}/posteingang`);
    return { ok: "Gesendet." };
  } catch (e) {
    return err(e);
  }
}

export async function noteAction(slug: string, conversationId: string, _prev: InboxActionState, fd: FormData): Promise<InboxActionState> {
  try {
    const { ws, user } = await guard(slug, EDIT);
    await addNote(ws.id, conversationId, user.id, String(fd.get("note") ?? ""));
    revalidatePath(`/sa/${slug}/posteingang`);
    return { ok: "Notiz gespeichert." };
  } catch (e) {
    return err(e);
  }
}

export async function draftAction(slug: string, conversationId: string): Promise<InboxActionState> {
  try {
    const { ws } = await guard(slug, EDIT);
    await ownConversation(ws.id, conversationId);
    const { draft, sources } = await draftReply(ws.id, conversationId);
    return { draft, ok: sources.length ? `Entwurf auf Basis von: ${sources.slice(0, 3).join(", ")}` : "Entwurf ohne passende Wissensquelle – bitte Fakten prüfen." };
  } catch (e) {
    return err(e);
  }
}

const statusSchema = z.object({
  status: z.enum(["open", "pending", "snoozed", "closed"]),
  snoozeHours: z.coerce.number().int().min(1).max(24 * 60).optional(),
});

export async function statusAction(slug: string, conversationId: string, fd: FormData) {
  const { ws, user } = await guard(slug, EDIT);
  await ownConversation(ws.id, conversationId);
  const p = statusSchema.parse({ status: fd.get("status"), snoozeHours: fd.get("snoozeHours") || undefined });
  await db.conversation.update({
    where: { id: conversationId },
    data: { status: p.status, snoozedUntil: p.status === "snoozed" ? new Date(Date.now() + (p.snoozeHours ?? 24) * 3600_000) : null },
  });
  await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "inbox.status", target: conversationId, detail: { status: p.status } });
  revalidatePath(`/sa/${slug}/posteingang`);
}

export async function assignAction(slug: string, conversationId: string, fd: FormData) {
  const { ws, user } = await guard(slug, EDIT);
  await ownConversation(ws.id, conversationId);
  const raw = String(fd.get("assigneeId") ?? "");
  let assigneeId: string | null = raw === "" ? null : raw === "me" ? user.id : raw;
  if (assigneeId) {
    // nur aktive Personen mit Zugriff auf den Sub-Account
    const ok = await db.user.findFirst({
      where: { id: assigneeId, active: true, OR: [{ memberships: { some: { workspaceId: ws.id } } }, { agencyRole: { in: ["owner", "admin"] } }] },
      select: { id: true },
    });
    if (!ok) assigneeId = null;
  }
  await db.conversation.update({ where: { id: conversationId }, data: { assigneeId } });
  revalidatePath(`/sa/${slug}/posteingang`);
}

export async function tagsAction(slug: string, conversationId: string, fd: FormData) {
  const { ws } = await guard(slug, EDIT);
  await ownConversation(ws.id, conversationId);
  const tags = String(fd.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20)
    .map((t) => t.slice(0, 40));
  await db.conversation.update({ where: { id: conversationId }, data: { tags: Array.from(new Set(tags)) } });
  revalidatePath(`/sa/${slug}/posteingang`);
}

export async function toTicketAction(slug: string, conversationId: string, _prev: InboxActionState): Promise<InboxActionState> {
  try {
    const { ws, user, access } = await guard(slug, EDIT);
    if (!can(access, "tickets", "edit")) return { error: "Keine Berechtigung, Tickets anzulegen." };
    const c = await ownConversation(ws.id, conversationId);
    if (c.ticketId) return { ok: "Es gibt bereits ein Ticket zu diesem Gespräch." };
    const first = await db.message.findFirst({ where: { conversationId, direction: "in" }, orderBy: { createdAt: "asc" }, select: { bodyText: true } });
    const ticket = await db.$transaction(async (tx) => {
      const t = await createTicket(
        ws.id,
        {
          subject: c.subject?.trim() || "Anfrage aus dem Posteingang",
          description: `${(first?.bodyText ?? "").slice(0, 4000)}\n\nGespräch im Posteingang: /sa/${slug}/posteingang?c=${conversationId}`,
          source: "email",
          contactId: c.contactId ?? undefined,
          ownerId: user.id,
        },
        tx,
      );
      await tx.conversation.update({ where: { id: conversationId }, data: { ticketId: t.id } });
      return t;
    });
    revalidatePath(`/sa/${slug}/posteingang`);
    return { ok: `Ticket #${ticket.numericId} angelegt.` };
  } catch (e) {
    return err(e);
  }
}

export async function markReadAction(slug: string, conversationId: string) {
  const { ws } = await guard(slug, { object: "email", action: "read" });
  await db.conversation.updateMany({ where: { id: conversationId, workspaceId: ws.id, unread: { gt: 0 } }, data: { unread: 0 } });
}

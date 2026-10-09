"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard, forbiddenToState } from "@/lib/permissions/guard";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs";
import { getChannelAdapter } from "@/lib/inbox/channel";
import "@/lib/inbox/register";
import { emailConfigSchema, inboxCommonSchema, parseInboxConfig } from "@/lib/inbox/config";
import { openCredentials, sealCredentials } from "@/lib/inbox/credentials";

export type SettingsState = { error?: string; ok?: string };

const NEED = { special: "manage_keys" } as const;

function err(e: unknown): SettingsState {
  if (e instanceof z.ZodError) return { error: `Eingabe prüfen: ${e.issues.map((i) => i.path.join(".")).join(", ")}` };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Diese Adresse ist bereits als Postfach verbunden." };
  return forbiddenToState(e) ?? { error: e instanceof Error ? e.message : "Unbekannter Fehler" };
}

async function ownInbox(workspaceId: string, id: string) {
  const i = await db.inbox.findFirst({ where: { id, workspaceId } });
  if (!i) throw new Error("Postfach nicht gefunden");
  return i;
}

/** Anlegen bzw. Ändern eines E-Mail-Postfachs. Leere Passwortfelder behalten das gespeicherte Passwort. */
export async function saveEmailInboxAction(slug: string, inboxId: string | null, _prev: SettingsState, fd: FormData): Promise<SettingsState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    const str = (k: string) => String(fd.get(k) ?? "").trim();
    const name = z.string().trim().min(1).max(120).parse(str("name"));
    const address = z.string().trim().toLowerCase().email().max(200).parse(str("address"));
    const cfg = emailConfigSchema.parse({
      imapHost: str("imapHost"),
      imapPort: str("imapPort") || undefined,
      imapSecure: fd.get("imapSecure") === "on",
      imapUser: str("imapUser") || address,
      folder: str("folder") || undefined,
      smtpHost: str("smtpHost"),
      smtpPort: str("smtpPort") || undefined,
      smtpUser: str("smtpUser") || str("imapUser") || address,
      fromName: str("fromName") || undefined,
      markSeen: fd.get("markSeen") === "on",
    });
    const common = inboxCommonSchema.parse({
      signature: String(fd.get("signature") ?? "").slice(0, 5000) || undefined,
      assignment: str("assignment") || "manual",
      assigneeIds: fd.getAll("assigneeIds").map(String).filter(Boolean),
    });
    const existing = inboxId ? await ownInbox(ws.id, inboxId) : null;
    const prevCreds = existing ? openCredentials(existing) : {};
    const imapPassword = String(fd.get("imapPassword") ?? "") || prevCreds.imapPassword || "";
    const smtpPassword = String(fd.get("smtpPassword") ?? "") || prevCreds.smtpPassword || imapPassword;
    if (!imapPassword) return { error: "Bitte das IMAP-Passwort (bzw. App-Passwort) angeben." };
    const credentials = sealCredentials({ imapPassword, smtpPassword });
    // Merker beibehalten, solange Server/Ordner gleich bleiben – sonst neu beginnen
    const prevCfg = existing ? parseInboxConfig(existing.config) : null;
    const keepCursor = prevCfg && prevCfg.imapHost === cfg.imapHost && prevCfg.imapUser === cfg.imapUser;
    const config = { ...cfg, ...common, cursor: keepCursor ? prevCfg.cursor : {} } as Prisma.InputJsonValue;
    const saved = existing
      ? await db.inbox.update({ where: { id: existing.id }, data: { name, address, config, credentials, status: "ok", lastError: null } })
      : await db.inbox.create({ data: { workspaceId: ws.id, name, kind: "email", provider: "imap", address, config, credentials } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: existing ? "inbox.update" : "inbox.create", target: saved.id, detail: { address, imapHost: cfg.imapHost, smtpHost: cfg.smtpHost } });
    revalidatePath(`/sa/${slug}/posteingang`, "layout");
    return { ok: existing ? "Gespeichert." : "Postfach verbunden. Der erste Abruf holt die Nachrichten der letzten 7 Tage." };
  } catch (e) {
    return err(e);
  }
}

export async function testInboxAction(slug: string, inboxId: string, _prev: SettingsState): Promise<SettingsState> {
  try {
    const { ws } = await guard(slug, NEED);
    const inbox = await ownInbox(ws.id, inboxId);
    const adapter = getChannelAdapter(inbox.provider);
    if (!adapter?.test) return { error: "Für diesen Kanal gibt es keinen Verbindungstest." };
    const r = await adapter.test(inbox, openCredentials(inbox));
    await db.inbox.update({ where: { id: inbox.id }, data: r.ok ? { status: "ok", lastError: null } : { status: "error", lastError: r.detail.slice(0, 500) } });
    revalidatePath(`/sa/${slug}/posteingang/einstellungen`);
    return r.ok ? { ok: r.detail } : { error: r.detail };
  } catch (e) {
    return err(e);
  }
}

export async function pollNowAction(slug: string, inboxId: string) {
  const { ws } = await guard(slug, NEED);
  const inbox = await ownInbox(ws.id, inboxId);
  await enqueue("inbox.poll_one", { inboxId: inbox.id });
  revalidatePath(`/sa/${slug}/posteingang/einstellungen`);
}

export async function toggleInboxAction(slug: string, inboxId: string) {
  const { ws, user } = await guard(slug, NEED);
  const inbox = await ownInbox(ws.id, inboxId);
  await db.inbox.update({ where: { id: inbox.id }, data: { active: !inbox.active, ...(inbox.active ? {} : { status: "ok", lastError: null }) } });
  await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: inbox.active ? "inbox.deactivate" : "inbox.activate", target: inbox.id });
  revalidatePath(`/sa/${slug}/posteingang`, "layout");
}

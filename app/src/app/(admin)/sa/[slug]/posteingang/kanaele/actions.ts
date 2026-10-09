"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guard, forbiddenToState } from "@/lib/permissions/guard";
import { openCredentials, sealCredentials } from "@/lib/inbox/credentials";
import { getChannelAdapter } from "@/lib/inbox/channel";
import "@/lib/messaging/register";
import { toE164 } from "@/lib/messaging/phone";
import { validSenderId } from "@/lib/messaging/seven-sms";
import { sendTestMessage, ChannelSendError } from "@/lib/messaging/send";
import type { FormState } from "@/components/users/StateForm";

const NEED = { special: "manage_keys" } as const;
const back = (slug: string) => `/sa/${slug}/posteingang/kanaele`;
const msg = (e: unknown) => forbiddenToState(e)?.error ?? (e instanceof Error ? e.message : String(e)).slice(0, 300);

const waSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(80),
  number: z.string().trim().min(5, "Rufnummer fehlt"),
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Phone Number ID: nur Ziffern"),
  wabaId: z.string().trim().regex(/^\d{5,30}$/, "WABA-ID: nur Ziffern"),
  accessToken: z.string().trim().max(1000).optional(),
  appSecret: z.string().trim().max(200).optional(),
});

export async function saveWhatsApp(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    const p = waSchema.safeParse(Object.fromEntries(fd));
    if (!p.success) return { error: p.error.issues[0].message };
    const address = toE164(p.data.number);
    if (!address) return { error: "Rufnummer ungültig (bitte mit Ländervorwahl, z. B. +49 …)." };
    const existing = await db.inbox.findUnique({ where: { workspaceId_kind_address: { workspaceId: ws.id, kind: "whatsapp", address } } });
    const old = existing ? openCredentials(existing) : {};
    const creds = {
      accessToken: p.data.accessToken || old.accessToken || "",
      appSecret: p.data.appSecret || old.appSecret || "",
      verifyToken: old.verifyToken || randomBytes(16).toString("hex"),
    };
    if (!creds.accessToken || !creds.appSecret) return { error: "Zugriffstoken und App-Secret sind beim ersten Einrichten Pflicht." };
    const config = { ...((existing?.config as Record<string, unknown>) ?? {}), phoneNumberId: p.data.phoneNumberId, wabaId: p.data.wabaId } as Prisma.InputJsonValue;
    const inbox = await db.inbox.upsert({
      where: { workspaceId_kind_address: { workspaceId: ws.id, kind: "whatsapp", address } },
      create: { workspaceId: ws.id, name: p.data.name, kind: "whatsapp", address, provider: "whatsapp_cloud", config, credentials: sealCredentials(creds) },
      update: { name: p.data.name, provider: "whatsapp_cloud", config, credentials: sealCredentials(creds), active: true },
    });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "messaging.channel_saved", target: inbox.id, detail: { kind: "whatsapp" } });
    revalidatePath(back(slug));
    return { ok: "WhatsApp-Kanal gespeichert. Jetzt Webhook bei Meta eintragen und Verbindung testen." };
  } catch (e) {
    return { error: msg(e) };
  }
}

const smsSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(80),
  number: z.string().trim().min(5, "Rufnummer fehlt"),
  senderId: z.string().trim().max(16).optional(),
  apiKey: z.string().trim().max(300).optional(),
  signingSecret: z.string().trim().max(300).optional(),
});

export async function saveSms(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    const p = smsSchema.safeParse(Object.fromEntries(fd));
    if (!p.success) return { error: p.error.issues[0].message };
    const address = toE164(p.data.number);
    if (!address) return { error: "Rufnummer ungültig (bitte mit Ländervorwahl)." };
    if (p.data.senderId && !validSenderId(p.data.senderId)) return { error: "Absenderkennung: max. 11 Zeichen (Buchstaben/Ziffern) oder eine Rufnummer." };
    const existing = await db.inbox.findUnique({ where: { workspaceId_kind_address: { workspaceId: ws.id, kind: "sms", address } } });
    const old = existing ? openCredentials(existing) : {};
    const creds = { apiKey: p.data.apiKey || old.apiKey || "", signingSecret: p.data.signingSecret || old.signingSecret || "" };
    if (!creds.apiKey || !creds.signingSecret) return { error: "API-Schlüssel und Signierschlüssel sind beim ersten Einrichten Pflicht." };
    const config = { ...((existing?.config as Record<string, unknown>) ?? {}), senderId: p.data.senderId || undefined } as Prisma.InputJsonValue;
    const inbox = await db.inbox.upsert({
      where: { workspaceId_kind_address: { workspaceId: ws.id, kind: "sms", address } },
      create: { workspaceId: ws.id, name: p.data.name, kind: "sms", address, provider: "seven", config, credentials: sealCredentials(creds) },
      update: { name: p.data.name, provider: "seven", config, credentials: sealCredentials(creds), active: true },
    });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "messaging.channel_saved", target: inbox.id, detail: { kind: "sms" } });
    revalidatePath(back(slug));
    return { ok: "SMS-Kanal gespeichert. Webhook bei seven.io eintragen und Verbindung testen." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function testChannel(slug: string, inboxId: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws } = await guard(slug, NEED);
    const inbox = await db.inbox.findFirst({ where: { id: inboxId, workspaceId: ws.id } });
    if (!inbox) return { error: "Kanal nicht gefunden." };
    const adapter = getChannelAdapter(inbox.provider);
    if (!adapter?.test) return { error: "Für diesen Anbieter gibt es keinen Verbindungstest." };
    const r = await adapter.test(inbox, openCredentials(inbox));
    await db.inbox.update({ where: { id: inbox.id }, data: { status: r.ok ? "ok" : "error", lastError: r.ok ? null : r.detail.slice(0, 300) } });
    revalidatePath(back(slug));
    return r.ok ? { ok: r.detail } : { error: r.detail };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function setChannelActive(slug: string, inboxId: string, active: boolean, _prev: FormState): Promise<FormState> {
  try {
    const { ws, user } = await guard(slug, NEED);
    const r = await db.inbox.updateMany({ where: { id: inboxId, workspaceId: ws.id, kind: { in: ["whatsapp", "sms"] } }, data: { active } });
    if (!r.count) return { error: "Kanal nicht gefunden." };
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: active ? "messaging.channel_enabled" : "messaging.channel_disabled", target: inboxId });
    revalidatePath(back(slug));
    return { ok: active ? "Kanal aktiviert." : "Kanal deaktiviert. Eingehende Webhooks werden abgelehnt." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function sendTest(slug: string, inboxId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws } = await guard(slug, NEED);
    const to = String(fd.get("to") ?? "");
    const text = String(fd.get("text") ?? "").trim() || "Testnachricht aus dem CRM.";
    const r = await sendTestMessage(ws.id, inboxId, to, text);
    return { ok: r.delivery === "live" ? "Testnachricht gesendet." : "Testmodus: Nachricht protokolliert, nicht gesendet (MESSAGING_MODE=capture)." };
  } catch (e) {
    return { error: e instanceof ChannelSendError ? e.message : msg(e) };
  }
}

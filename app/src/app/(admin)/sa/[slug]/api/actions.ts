"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { guard, guardOrRedirect } from "@/lib/permissions/guard";
import { createApiKey, SCOPES, type Scope } from "@/lib/apikey";
import { WEBHOOK_EVENTS } from "@/lib/mail-schema";
import { deliverWebhook, validateWebhookUrl } from "@/lib/webhook";

const q = (s: string) => encodeURIComponent(s);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Nur Admins des Sub-Accounts verwalten Schlüssel, Webhooks und Sperrliste. */
async function adminWorkspace(slug: string) {
  const { ws, user } = await guardOrRedirect(slug, { special: "manage_keys" }, `/sa/${slug}/api`);
  return { ws, user };
}

export type KeyState = { error?: string; plain?: string; name?: string };

export async function createKeyAction(slug: string, _prev: KeyState, formData: FormData): Promise<KeyState> {
  let ctx;
  try {
    ctx = await guard(slug, { special: "manage_keys" });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "Für Schlüssel fehlt das Recht „API-, MCP- und Webhook-Zugänge verwalten“." };
    throw e;
  }
  const { ws, user } = ctx;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 80) return { error: "Bitte einen Namen (max. 80 Zeichen) angeben, z. B. „Kompetenzanker Produktion“." };
  const scopes = formData.getAll("scopes").map(String).filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  if (scopes.length === 0) return { error: "Mindestens eine Berechtigung wählen." };
  if ((await db.apiKey.count({ where: { workspaceId: ws.id, revokedAt: null } })) >= 50) return { error: "Maximal 50 aktive Schlüssel." };
  const { plain } = await createApiKey({ workspaceId: ws.id, name, scopes, createdBy: user.name });
  revalidatePath(`/sa/${slug}/api`);
  return { plain, name };
}

export async function revokeKey(slug: string, id: string) {
  const { ws } = await adminWorkspace(slug);
  await db.apiKey.updateMany({ where: { id, workspaceId: ws.id, revokedAt: null }, data: { revokedAt: new Date() } });
  redirect(`/sa/${slug}/api?ok=${q("Schlüssel widerrufen – Aufrufe damit werden ab sofort abgelehnt.")}`);
}

const hookSchema = z.object({
  url: z.string().trim().min(8).max(500),
  description: z.string().trim().max(300).optional(),
  type: z.enum(["transactional", "marketing"]),
  sign: z.string().optional(),
});

export async function createWebhook(slug: string, formData: FormData) {
  const { ws } = await adminWorkspace(slug);
  const back = `/sa/${slug}/api?tab=webhooks`;
  const p = hookSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) redirect(`${back}&fehler=${q(p.error.issues[0].message)}`);
  const problem = validateWebhookUrl(p.data.url);
  if (problem) redirect(`${back}&fehler=${q(problem)}`);
  const events = formData.getAll("events").map(String).filter((e) => e in WEBHOOK_EVENTS);
  if (events.length === 0) redirect(`${back}&fehler=${q("Mindestens ein Ereignis wählen.")}`);
  await db.webhook.create({
    data: {
      workspaceId: ws.id,
      url: p.data.url,
      description: p.data.description || null,
      type: p.data.type,
      events,
      secret: p.data.sign ? randomBytes(24).toString("base64url") : null,
    },
  });
  redirect(`${back}&ok=${q("Webhook angelegt")}`);
}

export async function toggleWebhook(slug: string, id: string) {
  const { ws } = await adminWorkspace(slug);
  const w = await db.webhook.findFirst({ where: { id, workspaceId: ws.id } });
  if (w) await db.webhook.update({ where: { id: w.id }, data: { active: !w.active } });
  redirect(`/sa/${slug}/api?tab=webhooks&ok=${q(w?.active ? "Webhook pausiert" : "Webhook aktiv")}`);
}

export async function deleteWebhook(slug: string, id: string) {
  const { ws } = await adminWorkspace(slug);
  await db.webhook.deleteMany({ where: { id, workspaceId: ws.id } });
  redirect(`/sa/${slug}/api?tab=webhooks&ok=${q("Webhook gelöscht")}`);
}

export async function testWebhook(slug: string, id: string) {
  const { ws } = await adminWorkspace(slug);
  const w = await db.webhook.findFirst({ where: { id, workspaceId: ws.id } });
  if (!w) redirect(`/sa/${slug}/api?tab=webhooks&fehler=${q("Webhook nicht gefunden")}`);
  let error: string | null = null;
  try {
    await deliverWebhook(w.id, { event: "test", email: "test@example.com", id: w.numericId, date: new Date().toISOString(), ts: Math.floor(Date.now() / 1000), "message-id": "<test@pioneerdesk.local>", subject: "Testereignis", tag: "test" });
  } catch (e) {
    error = errMsg(e);
  }
  redirect(`/sa/${slug}/api?tab=webhooks&${error ? `fehler=${q(`Test fehlgeschlagen: ${error}`)}` : `ok=${q("Testereignis zugestellt (2xx)")}`}`);
}

export async function addSuppression(slug: string, formData: FormData) {
  const { ws, user } = await adminWorkspace(slug);
  const back = `/sa/${slug}/api?tab=sperrliste`;
  const p = z.object({ email: z.email().max(254), note: z.string().trim().min(3, "Bitte kurz begründen").max(200) }).safeParse(Object.fromEntries(formData));
  if (!p.success) redirect(`${back}&fehler=${q(p.error.issues[0].message)}`);
  const email = p.data.email.toLowerCase();
  await db.suppression.upsert({
    where: { workspaceId_email: { workspaceId: ws.id, email } },
    create: { workspaceId: ws.id, email, reason: "manual", source: `${user.name}: ${p.data.note}`.slice(0, 250) },
    update: {},
  });
  await db.activity.create({ data: { workspaceId: ws.id, type: "SYSTEM", body: `Sperrliste: ${email} gesperrt (${p.data.note})`, meta: { by: user.name } } });
  redirect(`${back}&ok=${q(`${email} gesperrt`)}`);
}

export async function removeSuppression(slug: string, id: string, formData: FormData) {
  const { ws, user } = await adminWorkspace(slug);
  const back = `/sa/${slug}/api?tab=sperrliste`;
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 3) redirect(`${back}&fehler=${q("Bitte begründen, warum die Sperre aufgehoben wird.")}`);
  const s = await db.suppression.findFirst({ where: { id, workspaceId: ws.id } });
  if (!s) redirect(`${back}&fehler=${q("Eintrag nicht gefunden")}`);
  await db.suppression.delete({ where: { id: s.id } });
  await db.activity.create({
    data: { workspaceId: ws.id, type: "SYSTEM", body: `Sperrliste: ${s.email} entsperrt (vorher: ${s.reason}; Grund: ${note.slice(0, 200)})`, meta: { by: user.name } },
  });
  redirect(`${back}&ok=${q(`${s.email} entsperrt`)}`);
}

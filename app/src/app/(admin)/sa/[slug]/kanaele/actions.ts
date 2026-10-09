"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guard } from "@/lib/permissions/guard";
import { ForbiddenError } from "@/lib/permissions";
import { syncAccount } from "@/lib/channels/sync";
import { openCredentials } from "@/lib/channels/crypto";
import { PLATFORMS } from "@/lib/channels/types";

export type FormState = { ok?: string; error?: string };
const msg = (e: unknown) => (e instanceof ForbiddenError ? e.message : e instanceof Error ? e.message : String(e));

const ChannelSchema = z.object({
  platform: z.enum(PLATFORMS, { error: "Plattform wählen" }),
  handle: z.string().trim().min(1, "Name/Handle fehlt").max(200),
  url: z.union([z.literal(""), z.url({ protocol: /^https?$/, error: "URL ungültig" })]).optional(),
  externalId: z.string().trim().max(200).optional(),
});

export async function addChannel(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws } = await guard(slug, { object: "analytics", action: "edit" });
    const p = ChannelSchema.safeParse({
      platform: fd.get("platform"),
      handle: fd.get("handle"),
      url: fd.get("url") ?? "",
      externalId: fd.get("externalId") || undefined,
    });
    if (!p.success) return { error: p.error.issues[0].message };
    await db.channelAccount.create({
      data: { workspaceId: ws.id, platform: p.data.platform, handle: p.data.handle, url: p.data.url || null, externalId: p.data.externalId || null },
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Diesen Kanal gibt es schon." };
    return { error: msg(e) };
  }
  revalidatePath(`/sa/${slug}/kanaele`);
  return { ok: "Kanal angelegt." };
}

async function ownChannel(slug: string, id: string, need: Parameters<typeof guard>[1]) {
  const ctx = await guard(slug, need);
  const acc = await db.channelAccount.findFirst({ where: { id, workspaceId: ctx.ws.id } });
  if (!acc) throw new Error("Kanal nicht gefunden");
  return { ...ctx, acc };
}

export async function deleteChannel(slug: string, id: string) {
  const { acc } = await ownChannel(slug, id, { object: "analytics", action: "delete" });
  await db.channelAccount.delete({ where: { id: acc.id } });
  revalidatePath(`/sa/${slug}/kanaele`);
  revalidatePath("/");
}

const optInt = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number().int("Ganze Zahl erwartet").min(0, "Nicht negativ").max(2_000_000_000).optional(),
);
const MetricSchema = z.object({ date: z.iso.date("Datum ungültig"), followers: optInt, views: optInt, posts: optInt });

export async function addMetric(slug: string, id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { acc } = await ownChannel(slug, id, { object: "analytics", action: "edit" });
    const p = MetricSchema.safeParse({ date: fd.get("date"), followers: fd.get("followers"), views: fd.get("views"), posts: fd.get("posts") });
    if (!p.success) return { error: p.error.issues[0].message };
    const { date, ...values } = p.data;
    const data = { followers: values.followers ?? null, views: values.views ?? null, posts: values.posts ?? null, extra: { source: "manuell" } };
    const day = new Date(`${date}T00:00:00Z`);
    await db.channelMetric.upsert({ where: { accountId_date: { accountId: acc.id, date: day } }, create: { accountId: acc.id, date: day, ...data }, update: data });
    revalidatePath(`/sa/${slug}/kanaele`);
    revalidatePath("/");
    return { ok: "Kennzahlen gespeichert." };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** „Jetzt abrufen“ über die Plattform-Schnittstelle. */
export async function syncChannel(slug: string, id: string, _prev: FormState): Promise<FormState> {
  try {
    const { ws, acc } = await ownChannel(slug, id, { object: "analytics", action: "edit" });
    const r = await syncAccount(acc.id, ws.id);
    revalidatePath(`/sa/${slug}/kanaele`);
    revalidatePath("/");
    if (!r.ok) return { error: r.reauth ? `Bitte neu verbinden: ${r.message}` : r.message };
    const f = (n: number | null) => (n == null ? "–" : new Intl.NumberFormat("de-DE").format(n));
    return { ok: `Abgerufen: ${f(r.metrics.followers)} Follower, ${f(r.metrics.views)} Aufrufe, ${r.posts} Beiträge.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Nach dem Verbinden: zu lesendes Konto (Seite/Organisation) wählen – nur aus den gelieferten Kandidaten. */
export async function selectAccount(slug: string, id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { acc, ws, user } = await ownChannel(slug, id, { special: "manage_keys" });
    const creds = openCredentials(acc.credentials);
    const candidates = (creds?.extra?.candidates as { id: string; name: string; url?: string | null }[] | undefined) ?? [];
    const chosen = candidates.find((c) => c.id === String(fd.get("externalId") ?? ""));
    if (!chosen) return { error: "Bitte ein Konto aus der Liste wählen." };
    await db.channelAccount.update({ where: { id: acc.id }, data: { externalId: chosen.id, url: acc.url ?? chosen.url ?? null, lastError: null } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "channel.account_selected", target: acc.id });
    revalidatePath(`/sa/${slug}/kanaele`);
    return { ok: `„${chosen.name}“ ausgewählt.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

/** Verbindung trennen: Zugangsdaten löschen (Kennzahlen bleiben). Widerruf bei der Plattform erfolgt dort in den App-Einstellungen. */
export async function disconnectChannel(slug: string, id: string) {
  const { acc, ws, user } = await ownChannel(slug, id, { special: "manage_keys" });
  await db.channelAccount.update({ where: { id: acc.id }, data: { credentials: null, tokenExpiresAt: null, connection: "manual", lastError: null } });
  await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "channel.disconnected", target: acc.id });
  revalidatePath(`/sa/${slug}/kanaele`);
}

export async function deleteMetric(slug: string, channelId: string, metricId: string) {
  const { acc } = await ownChannel(slug, channelId, { object: "analytics", action: "delete" });
  await db.channelMetric.deleteMany({ where: { id: metricId, accountId: acc.id } });
  revalidatePath(`/sa/${slug}/kanaele`);
}


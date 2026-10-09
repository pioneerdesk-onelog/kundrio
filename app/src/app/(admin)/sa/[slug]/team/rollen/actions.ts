"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ACTIONS, OBJECT_KEYS, PRESETS, SPECIAL_KEYS, parsePermissions, type PresetKey, type Permissions } from "@/lib/permissions/catalog";
import { normalizePermissions } from "@/lib/permissions/escalation";
import type { FormState } from "@/components/users/StateForm";
import { mayGrant, requireTeamAdmin } from "../guard";

const err = (e: unknown): FormState => ({ error: (e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : String(e)).slice(0, 300) });
const ESCALATION = "Diese Rolle hätte mehr Rechte als Ihre eigene. Bitte nur Rechte vergeben, die Sie selbst haben.";

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "rolle";
}

/** Matrix aus dem Formular lesen (fehlende Felder = keine Rechte). */
function readMatrix(fd: FormData): Permissions {
  const objects: Record<string, Record<string, string>> = {};
  for (const k of OBJECT_KEYS) {
    objects[k] = {};
    for (const a of ACTIONS) objects[k][a] = String(fd.get(`o.${k}.${a}`) ?? "none");
  }
  const special = Object.fromEntries(SPECIAL_KEYS.map((s) => [s, fd.get(`s.${s}`) === "on"]));
  return normalizePermissions(parsePermissions({ objects, special }));
}

async function loadRole(slug: string, roleId: string) {
  const ctx = await requireTeamAdmin(slug);
  const role = await db.role.findFirst({ where: { id: roleId, workspaceId: ctx.ws.id } });
  if (!role) throw new Error("Rolle nicht gefunden.");
  if (role.key === "admin") throw new Error("Die Admin-Rolle ist geschützt und kann nicht eingeschränkt werden (Schutz vor Aussperren).");
  if (!ctx.staff) {
    const own = await db.membership.findUnique({ where: { userId_workspaceId: { userId: ctx.user.id, workspaceId: ctx.ws.id } } });
    if (own?.roleId === role.id) throw new Error("Die eigene Rolle kann nur ein anderer Admin ändern.");
    if (!mayGrant(ctx.access, ctx.staff, role.permissions)) throw new Error("Diese Rolle hat mehr Rechte als Sie.");
  }
  return { ...ctx, role };
}

export async function saveRole(slug: string, roleId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user, access, staff, role } = await loadRole(slug, roleId);
    const name = z.string().trim().min(1, "Bitte einen Namen angeben.").max(60).parse(fd.get("name"));
    const description = z.string().trim().max(200).parse(fd.get("description") ?? "");
    const perms = readMatrix(fd);
    if (!mayGrant(access, staff, perms)) return { error: ESCALATION };
    await db.role.update({ where: { id: role.id }, data: { name, description: description || null, permissions: perms as unknown as Prisma.InputJsonValue } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "role.updated", target: role.id, detail: { key: role.key } });
    revalidatePath(`/sa/${slug}/team/rollen`);
    return { ok: "Gespeichert. Die Änderung gilt sofort für alle Mitglieder mit dieser Rolle." };
  } catch (e) {
    return err(e);
  }
}

export async function resetRole(slug: string, roleId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, user, access, staff, role } = await loadRole(slug, roleId);
    const preset = role.presetKey && role.presetKey in PRESETS ? PRESETS[role.presetKey as PresetKey] : null;
    if (!preset) return { error: "Diese Rolle stammt aus keiner Vorlage." };
    if (!mayGrant(access, staff, preset.permissions)) return { error: ESCALATION };
    await db.role.update({ where: { id: role.id }, data: { permissions: preset.permissions as unknown as Prisma.InputJsonValue, name: preset.name, description: preset.description } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "role.reset", target: role.id });
    revalidatePath(`/sa/${slug}/team/rollen`);
    return { ok: "Auf Vorlage zurückgesetzt." };
  } catch (e) {
    return err(e);
  }
}

export async function createRole(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  let newId: string;
  try {
    const { ws, user, access, staff } = await requireTeamAdmin(slug);
    const name = z.string().trim().min(2, "Bitte einen Namen angeben.").max(60).parse(fd.get("name"));
    const from = await db.role.findFirst({ where: { id: String(fd.get("fromId") ?? ""), workspaceId: ws.id } });
    if (!from) return { error: "Bitte eine Vorlage wählen." };
    if (!mayGrant(access, staff, from.permissions)) return { error: ESCALATION };
    let key = slugify(name);
    for (let i = 2; await db.role.findUnique({ where: { workspaceId_key: { workspaceId: ws.id, key } } }); i++) key = `${slugify(name).slice(0, 36)}-${i}`;
    const r = await db.role.create({
      data: { workspaceId: ws.id, key, name, description: `Kopie von „${from.name}“`, presetKey: null, permissions: from.permissions as Prisma.InputJsonValue },
    });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "role.created", target: r.id, detail: { from: from.key } });
    newId = r.id;
  } catch (e) {
    return err(e);
  }
  redirect(`/sa/${slug}/team/rollen/${newId}`);
}

export async function deleteRole(slug: string, roleId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, user, role } = await loadRole(slug, roleId);
    if (role.presetKey) return { error: "Vorlagen-Rollen können nicht gelöscht werden (nur angepasst oder zurückgesetzt)." };
    const used = await db.membership.count({ where: { roleId: role.id } });
    if (used) return { error: `Die Rolle ist noch ${used} Mitglied(ern) zugewiesen.` };
    await db.role.delete({ where: { id: role.id } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "role.deleted", target: role.id });
  } catch (e) {
    return err(e);
  }
  redirect(`/sa/${slug}/team/rollen`);
}

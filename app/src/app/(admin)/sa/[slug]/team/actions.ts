"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createInvitation, revokeInvitation, resendInvitation } from "@/lib/invitations";
import type { FormState } from "@/components/users/StateForm";
import { mayGrant, requireTeamAdmin } from "./guard";

const err = (e: unknown): FormState => ({ error: (e instanceof z.ZodError ? e.issues[0].message : e instanceof Error ? e.message : String(e)).slice(0, 300) });
const ESCALATION = "Sie können keine Rolle vergeben, die mehr Rechte hat als Ihre eigene.";

export async function inviteMember(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { user, ws, access, staff } = await requireTeamAdmin(slug);
    const d = z
      .object({ email: z.email("Bitte eine gültige E-Mail-Adresse angeben.").max(200), name: z.string().trim().max(120).optional(), roleKey: z.string().min(1).max(60) })
      .parse({ email: fd.get("email"), name: fd.get("name") || undefined, roleKey: fd.get("roleKey") });
    const role = await db.role.findUnique({ where: { workspaceId_key: { workspaceId: ws.id, key: d.roleKey } } });
    if (!role) return { error: "Unbekannte Rolle." };
    if (!mayGrant(access, staff, role.permissions)) return { error: ESCALATION };
    await createInvitation({ email: d.email, name: d.name, workspaceId: ws.id, roleKey: role.key, invitedBy: { id: user.id, name: user.name } });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: `Einladung an ${d.email} versendet.` };
  } catch (e) {
    return err(e);
  }
}

async function loadMember(slug: string, membershipId: string) {
  const ctx = await requireTeamAdmin(slug);
  const m = await db.membership.findFirst({ where: { id: membershipId, workspaceId: ctx.ws.id }, include: { roleRef: true } });
  if (!m) throw new Error("Mitglied nicht gefunden.");
  if (m.userId === ctx.user.id) throw new Error("Die eigene Rolle kann nicht geändert werden.");
  // Wer weniger Rechte hat, darf Mitglieder mit mehr Rechten nicht ändern
  if (m.roleRef && !mayGrant(ctx.access, ctx.staff, m.roleRef.permissions)) throw new Error("Dieses Mitglied hat mehr Rechte als Sie.");
  return { ...ctx, m };
}

export async function changeMemberRole(slug: string, membershipId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, access, staff, user, m } = await loadMember(slug, membershipId);
    const role = await db.role.findFirst({ where: { id: String(fd.get("roleId") ?? ""), workspaceId: ws.id } });
    if (!role) return { error: "Unbekannte Rolle." };
    if (!mayGrant(access, staff, role.permissions)) return { error: ESCALATION };
    await db.membership.update({ where: { id: m.id }, data: { roleId: role.id, role: role.key === "admin" ? "ADMIN" : "MEMBER" } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "member.role_changed", target: m.userId, detail: { from: m.roleRef?.key ?? null, to: role.key } });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Rolle geändert." };
  } catch (e) {
    return err(e);
  }
}

export async function removeMember(slug: string, membershipId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, user, m } = await loadMember(slug, membershipId);
    await db.$transaction([
      db.teamMember.deleteMany({ where: { userId: m.userId, team: { workspaceId: ws.id } } }),
      db.membership.delete({ where: { id: m.id } }),
    ]);
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "member.removed", target: m.userId });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Entfernt." };
  } catch (e) {
    return err(e);
  }
}

async function ownInvitation(slug: string, invitationId: string) {
  const ctx = await requireTeamAdmin(slug);
  const inv = await db.invitation.findFirst({ where: { id: invitationId, workspaceId: ctx.ws.id } });
  if (!inv) throw new Error("Einladung nicht gefunden.");
  return { ...ctx, inv };
}

export async function revokeMemberInvite(slug: string, invitationId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { user, inv } = await ownInvitation(slug, invitationId);
    await revokeInvitation(inv.id, user.id);
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Widerrufen." };
  } catch (e) {
    return err(e);
  }
}

export async function resendMemberInvite(slug: string, invitationId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { user, inv } = await ownInvitation(slug, invitationId);
    await resendInvitation(inv.id, { id: user.id, name: user.name });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Neu versendet." };
  } catch (e) {
    return err(e);
  }
}

// ---------- Teams (für Reichweite „Team“) ----------

const teamName = z.string().trim().min(1, "Bitte einen Namen angeben.").max(80);

export async function createTeam(slug: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await requireTeamAdmin(slug);
    const name = teamName.parse(fd.get("name"));
    if (await db.team.findUnique({ where: { workspaceId_name: { workspaceId: ws.id, name } } })) return { error: "Ein Team mit diesem Namen gibt es schon." };
    const t = await db.team.create({ data: { workspaceId: ws.id, name } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "team.created", target: t.id });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Team angelegt." };
  } catch (e) {
    return err(e);
  }
}

export async function saveTeam(slug: string, teamId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await requireTeamAdmin(slug);
    const team = await db.team.findFirst({ where: { id: teamId, workspaceId: ws.id } });
    if (!team) return { error: "Team nicht gefunden." };
    const name = teamName.parse(fd.get("name"));
    const wanted = fd.getAll("member").map(String);
    // Nur echte Mitglieder dieses Sub-Accounts (oder Agentur-Staff) zulassen
    const allowed = await db.user.findMany({
      where: { id: { in: wanted }, active: true, OR: [{ memberships: { some: { workspaceId: ws.id } } }, { agencyRole: { in: ["owner", "admin"] } }] },
      select: { id: true },
    });
    await db.$transaction([
      db.team.update({ where: { id: team.id }, data: { name } }),
      db.teamMember.deleteMany({ where: { teamId: team.id } }),
      db.teamMember.createMany({ data: allowed.map((u) => ({ teamId: team.id, userId: u.id })) }),
    ]);
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "team.updated", target: team.id, detail: { members: allowed.length } });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Team gespeichert." };
  } catch (e) {
    return err(e);
  }
}

export async function deleteTeam(slug: string, teamId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const { ws, user } = await requireTeamAdmin(slug);
    const r = await db.team.deleteMany({ where: { id: teamId, workspaceId: ws.id } });
    if (r.count) await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "team.deleted", target: teamId });
    revalidatePath(`/sa/${slug}/team`);
    return { ok: "Team gelöscht." };
  } catch (e) {
    return err(e);
  }
}

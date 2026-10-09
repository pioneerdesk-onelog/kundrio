"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isDemoGuest } from "@/lib/demo";
import { isAgencyStaff } from "@/lib/permissions";
import { checkAgencyChange, type AgencyRole } from "@/lib/permissions/escalation";
import { createInvitation, resendInvitation, revokeInvitation } from "@/lib/invitations";
import type { FormState } from "@/components/users/StateForm";

const err = (e: unknown): FormState => ({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
const ROLE = z.enum(["owner", "admin", "member"]);

async function requireStaff() {
  const user = await requireUser();
  if (!isAgencyStaff(user)) throw new Error("Nur Inhaber oder Admins der Agentur verwalten Benutzer.");
  return user;
}

const inviteSchema = z.object({
  email: z.email("Bitte eine gültige E-Mail-Adresse angeben.").max(200),
  name: z.string().trim().max(120).optional(),
  agencyRole: ROLE,
  // Sub-Account-Zuweisungen für Mitarbeiter: "<workspaceId>:<roleKey>"
  grants: z.array(z.string().regex(/^[a-z0-9]+:[a-z0-9_-]+$/i)).max(50),
});

export async function inviteAgencyUser(_prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const actor = await requireStaff();
    const grants = fd.getAll("ws").map(String).filter(Boolean).map((wsId) => `${wsId}:${String(fd.get(`role_${wsId}`) ?? "")}`);
    const d = inviteSchema.parse({ email: fd.get("email"), name: fd.get("name") || undefined, agencyRole: fd.get("agencyRole"), grants });
    if ((d.agencyRole === "owner" || d.agencyRole === "admin") && actor.agencyRole !== "owner") {
      return { error: "Nur Inhaber dürfen Inhaber oder Admins einladen." };
    }
    if (d.agencyRole === "member" && d.grants.length === 0) return { error: "Mitarbeiter brauchen mindestens einen Sub-Account mit Rolle." };
    const inviter = { id: actor.id, name: actor.name };
    if (d.agencyRole !== "member") {
      await createInvitation({ email: d.email, name: d.name, agencyRole: d.agencyRole, invitedBy: inviter });
    }
    for (const g of d.grants) {
      const [workspaceId, roleKey] = g.split(":");
      await createInvitation({ email: d.email, name: d.name, workspaceId, roleKey, invitedBy: inviter });
    }
    revalidatePath("/benutzer");
    return { ok: `Einladung an ${d.email} versendet.` };
  } catch (e) {
    return err(e instanceof z.ZodError ? new Error(e.issues[0].message) : e);
  }
}

async function changeAgency(targetId: string, newRole: AgencyRole | null) {
  const actor = await requireStaff();
  const target = await db.user.findUniqueOrThrow({ where: { id: targetId } });
  if (isDemoGuest(target.email)) throw new Error("Das Demo-Gastkonto lässt sich nicht ändern.");
  const activeOwners = await db.user.count({ where: { agencyRole: "owner", active: true } });
  const problem = checkAgencyChange({
    actorId: actor.id,
    actorRole: actor.agencyRole as AgencyRole,
    targetId,
    targetRole: target.agencyRole as AgencyRole,
    newRole,
    activeOwners,
  });
  if (problem) throw new Error(problem);
  return { actor, target };
}

export async function setAgencyRole(targetId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  try {
    const newRole = ROLE.parse(fd.get("agencyRole"));
    const { actor, target } = await changeAgency(targetId, newRole);
    if (newRole === target.agencyRole) return { ok: "Unverändert." };
    await db.user.update({ where: { id: targetId }, data: { agencyRole: newRole, isAgencyAdmin: newRole !== "member" } });
    await audit({ actor: `user:${actor.id}`, action: "user.agency_role", target: targetId, detail: { from: target.agencyRole, to: newRole } });
    revalidatePath("/benutzer");
    return { ok: "Agentur-Rolle geändert." };
  } catch (e) {
    return err(e);
  }
}

export async function setActive(targetId: string, active: boolean, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    let actor;
    let target;
    if (!active) {
      // Deaktivieren = wie „Rolle entziehen“: gleiche Regeln (letzter Inhaber, nur Inhaber für Admins …)
      ({ actor, target } = await changeAgency(targetId, null));
    } else {
      actor = await requireStaff();
      if (actor.id === targetId) throw new Error("Das eigene Konto kann nicht geändert werden.");
      target = await db.user.findUniqueOrThrow({ where: { id: targetId } });
      if ((target.agencyRole === "owner" || target.agencyRole === "admin") && actor.agencyRole !== "owner") {
        throw new Error("Nur Inhaber dürfen Inhaber oder Admins reaktivieren.");
      }
      if (target.passwordHash === "invited") return { error: "Eingeladene Benutzer werden durch Annahme der Einladung aktiv." };
    }
    await db.user.update({ where: { id: targetId }, data: { active } });
    if (!active) await db.session.deleteMany({ where: { userId: targetId } });
    await audit({ actor: `user:${actor.id}`, action: active ? "user.reactivated" : "user.deactivated", target: target.id });
    revalidatePath("/benutzer");
    return { ok: active ? "Benutzer reaktiviert." : "Benutzer deaktiviert, alle Sitzungen beendet." };
  } catch (e) {
    return err(e);
  }
}

export async function resendInvite(invitationId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const actor = await requireStaff();
    await resendInvitation(invitationId, { id: actor.id, name: actor.name });
    revalidatePath("/benutzer");
    return { ok: "Neu versendet." };
  } catch (e) {
    return err(e);
  }
}

export async function revokeInvite(invitationId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  try {
    const actor = await requireStaff();
    await revokeInvitation(invitationId, actor.id);
    revalidatePath("/benutzer");
    return { ok: "Widerrufen." };
  } catch (e) {
    return err(e);
  }
}

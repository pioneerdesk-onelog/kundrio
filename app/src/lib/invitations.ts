import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { audit } from "./audit";
import { formatAddress, newMessageId, sendMail, sendRaw } from "./mail";
import { ensureRoles } from "./permissions";
import type { AgencyRole } from "./permissions/escalation";

// Einladungen: Token 32 Byte (nur SHA-256 in der DB), 7 Tage gültig.
// Neue E-Mail-Adresse → Benutzer wird inaktiv mit Platzhalter-Passwort angelegt (Status „eingeladen“)
// und erst bei Annahme aktiviert. Bestehende Benutzer bestätigen nur (Anmeldung mit passender E-Mail).

const TTL_MS = 7 * 24 * 3600 * 1000;
/** Kein gültiger scrypt-Hash → Anmeldung unmöglich, bis die Einladung angenommen ist */
export const INVITED_PASSWORD = "invited";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function inviteUrl(token: string) {
  return `${env.appUrl()}/einladung/${token}`;
}

export type InviteInput = {
  email: string;
  name?: string;
  /** Sub-Account-Einladung */
  workspaceId?: string;
  roleKey?: string;
  /** Agentur-Einladung */
  agencyRole?: AgencyRole;
  invitedBy: { id: string; name: string };
};

/** Legt die Einladung an (inkl. Platzhalter-Benutzer) und versendet die Mail. Gibt den Klartext-Token zurück. */
export async function createInvitation(input: InviteInput) {
  const email = input.email.trim().toLowerCase();
  if (!input.workspaceId && !input.agencyRole) throw new Error("Bitte einen Sub-Account oder eine Agentur-Rolle wählen.");
  if (input.workspaceId) {
    await ensureRoles(input.workspaceId);
    const role = await db.role.findUnique({ where: { workspaceId_key: { workspaceId: input.workspaceId, key: input.roleKey ?? "" } } });
    if (!role) throw new Error("Unbekannte Rolle.");
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (!existing) {
    await db.user.create({
      data: { email, name: (input.name?.trim() || email.split("@")[0]).slice(0, 120), passwordHash: INVITED_PASSWORD, active: false, agencyRole: "member" },
    });
  } else if (input.workspaceId && existing.active) {
    const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId: existing.id, workspaceId: input.workspaceId } } });
    if (m) throw new Error("Diese Person ist bereits Mitglied dieses Sub-Accounts.");
  }

  // Ältere offene Einladungen für dasselbe Ziel ersetzen
  await db.invitation.updateMany({
    where: { email, workspaceId: input.workspaceId ?? null, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = randomBytes(32).toString("base64url");
  const inv = await db.invitation.create({
    data: {
      email,
      workspaceId: input.workspaceId ?? null,
      roleKey: input.workspaceId ? (input.roleKey ?? null) : null,
      agencyRole: input.agencyRole ?? null,
      tokenHash: sha256(token),
      invitedBy: input.invitedBy.id,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  await sendInvitationMail(inv.id, token, input.invitedBy.name);
  await audit({ workspaceId: input.workspaceId ?? null, actor: `user:${input.invitedBy.id}`, action: "invitation.created", target: inv.id, detail: { roleKey: input.roleKey ?? null, agencyRole: input.agencyRole ?? null } });
  return { invitation: inv, token };
}

/** Neuer Token + neue Mail (alter Link wird ungültig). */
export async function resendInvitation(invitationId: string, actor: { id: string; name: string }) {
  const inv = await db.invitation.findUniqueOrThrow({ where: { id: invitationId } });
  if (inv.acceptedAt || inv.revokedAt) throw new Error("Diese Einladung ist nicht mehr offen.");
  const token = randomBytes(32).toString("base64url");
  await db.invitation.update({ where: { id: inv.id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  await sendInvitationMail(inv.id, token, actor.name);
  await audit({ workspaceId: inv.workspaceId, actor: `user:${actor.id}`, action: "invitation.resent", target: inv.id });
}

export async function revokeInvitation(invitationId: string, actorId: string) {
  const inv = await db.invitation.findUniqueOrThrow({ where: { id: invitationId } });
  if (inv.acceptedAt) throw new Error("Bereits angenommene Einladungen können nicht widerrufen werden.");
  await db.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await audit({ workspaceId: inv.workspaceId, actor: `user:${actorId}`, action: "invitation.revoked", target: inv.id });
}

async function sendInvitationMail(invitationId: string, token: string, inviterName: string) {
  const inv = await db.invitation.findUniqueOrThrow({ where: { id: invitationId }, include: { workspace: true } });
  const target = inv.workspace ? `den Sub-Account „${inv.workspace.name}“` : `die Agentur ${(await db.agency.findFirst({ select: { name: true } }))?.name ?? ""}`.trim();
  const role = inv.workspace
    ? (await db.role.findUnique({ where: { workspaceId_key: { workspaceId: inv.workspace.id, key: inv.roleKey ?? "" } } }))?.name ?? inv.roleKey
    : { owner: "Inhaber", admin: "Admin", member: "Mitarbeiter" }[inv.agencyRole ?? "member"];
  const subject = "Einladung zum Kundrio";
  const text =
    `Hallo,\n\n${inviterName} lädt Sie in ${target} ein (Rolle: ${role}).\n\n` +
    `Einladung annehmen (7 Tage gültig):\n${inviteUrl(token)}\n\n` +
    `Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail einfach.`;

  // Absender: Sub-Account der Einladung; bei Agentur-Einladungen SYSTEM_MAIL_FROM oder der erste Sub-Account mit Absender
  if (inv.workspace?.mailFromEmail) {
    await sendMail({ workspaceId: inv.workspace.id, to: inv.email, subject, text, kind: "system" });
    return;
  }
  const systemFrom = process.env.SYSTEM_MAIL_FROM?.trim();
  if (systemFrom) {
    const addr = systemFrom.match(/<([^>]+)>/)?.[1] ?? systemFrom;
    await sendRaw({ from: systemFrom.includes("<") ? systemFrom : formatAddress(systemFrom, "Kundrio"), to: [inv.email], subject, text, messageId: newMessageId(addr) });
    return;
  }
  const ws = await db.workspace.findFirst({ where: { mailFromEmail: { not: null } }, orderBy: { name: "asc" } });
  if (!ws) throw new Error("Kein Absender konfiguriert (SYSTEM_MAIL_FROM oder Absender eines Sub-Accounts).");
  await sendMail({ workspaceId: ws.id, to: inv.email, subject, text, kind: "system" });
}

export type InvitationView = {
  id: string;
  email: string;
  workspaceName: string | null;
  roleName: string;
  newUser: boolean;
};

/** Lädt eine offene, gültige Einladung zum Token (null = ungültig/abgelaufen/benutzt). */
export async function findOpenInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Nimmt die Einladung an: aktiviert/aktualisiert den Benutzer und legt die Mitgliedschaft an. */
export async function acceptInvitation(token: string, opts: { userId: string; name?: string; passwordHash?: string }) {
  const inv = await findOpenInvitation(token);
  if (!inv) throw new Error("Die Einladung ist ungültig, abgelaufen oder wurde bereits verwendet.");
  const user = await db.user.findUniqueOrThrow({ where: { id: opts.userId } });
  if (user.email !== inv.email) throw new Error("Diese Einladung gilt für eine andere E-Mail-Adresse.");

  await db.$transaction(async (tx) => {
    // Einmalig verwenden: atomar beanspruchen
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count === 0) throw new Error("Die Einladung wurde bereits verwendet.");
    const data: { active: boolean; name?: string; passwordHash?: string; agencyRole?: string; isAgencyAdmin?: boolean } = { active: true };
    if (opts.name) data.name = opts.name.slice(0, 120);
    if (opts.passwordHash) data.passwordHash = opts.passwordHash;
    // Agentur-Rolle nur anheben, nie durch eine Einladung herabstufen
    if (inv.agencyRole) {
      const rank = { member: 0, admin: 1, owner: 2 } as const;
      const next = inv.agencyRole as AgencyRole;
      if (rank[next] > rank[(user.agencyRole as AgencyRole) ?? "member"]) {
        data.agencyRole = next;
        data.isAgencyAdmin = next === "owner" || next === "admin";
      }
    }
    await tx.user.update({ where: { id: user.id }, data });
    if (inv.workspaceId) {
      const role = await tx.role.findUnique({ where: { workspaceId_key: { workspaceId: inv.workspaceId, key: inv.roleKey ?? "" } } });
      if (!role) throw new Error("Die Rolle dieser Einladung existiert nicht mehr.");
      await tx.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: inv.workspaceId } },
        create: { userId: user.id, workspaceId: inv.workspaceId, roleId: role.id, role: role.key === "admin" ? "ADMIN" : "MEMBER" },
        update: { roleId: role.id, role: role.key === "admin" ? "ADMIN" : "MEMBER" },
      });
    }
  });
  await audit({ workspaceId: inv.workspaceId, actor: `user:${user.id}`, action: "invitation.accepted", target: inv.id });
  return inv;
}

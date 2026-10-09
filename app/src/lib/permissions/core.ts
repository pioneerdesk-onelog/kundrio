import { db } from "../db";
import { FULL, PRESETS, PRESET_KEYS, parsePermissions, type Permissions } from "./catalog";

// Rechte-Berechnung nur über die Datenbank (ohne Sitzung/Cookies) – nutzbar in Server Actions UND im Worker
// (z. B. Prozess-Veröffentlichung, Freigaben). Die Request-Variante mit Cache liegt in ./index.ts.

export type Access = {
  userId: string;
  workspaceId: string;
  roleKey: string; // "agency" bei Agentur-Inhaber/-Admin
  perms: Permissions;
  /** Benutzer, die mit dem Prüfenden ein Team teilen (inkl. ihm selbst) */
  teamUserIds: string[];
};

export function isAgencyStaff(user: { agencyRole: string; isAgencyAdmin: boolean }) {
  return user.agencyRole === "owner" || user.agencyRole === "admin" || user.isAgencyAdmin;
}

/** Legt fehlende Vorlagen-Rollen an und ordnet Alt-Mitgliedschaften zu (idempotent). */
export async function ensureRoles(workspaceId: string) {
  const existing = await db.role.findMany({ where: { workspaceId }, select: { key: true, id: true } });
  const have = new Set(existing.map((r) => r.key));
  for (const key of PRESET_KEYS) {
    if (have.has(key)) continue;
    const p = PRESETS[key];
    await db.role
      .create({ data: { workspaceId, key, name: p.name, description: p.description, presetKey: key, permissions: p.permissions } })
      .catch(() => {}); // gleichzeitiger Aufruf: eindeutiger Schlüssel verhindert Dubletten
  }
  // Alt-Mitgliedschaften (Welle 1: ADMIN/MEMBER) auf Rollen abbilden – MEMBER durfte bisher alles außer Verwaltung
  const orphans = await db.membership.findMany({ where: { workspaceId, roleId: null } });
  if (orphans.length) {
    const roles = await db.role.findMany({ where: { workspaceId, key: { in: ["admin", "teamleitung"] } } });
    const byKey = Object.fromEntries(roles.map((r) => [r.key, r.id]));
    for (const m of orphans) {
      await db.membership.update({ where: { id: m.id }, data: { roleId: m.role === "ADMIN" ? byKey.admin : byKey.teamleitung } });
    }
  }
}

async function teamMatesOf(userId: string, workspaceId: string) {
  const rows = await db.teamMember.findMany({
    where: { team: { workspaceId, members: { some: { userId } } } },
    select: { userId: true },
  });
  return Array.from(new Set([userId, ...rows.map((r) => r.userId)]));
}

/** Rechte des Benutzers im Sub-Account (null = kein Zugriff). */
export async function computeAccess(userId: string, workspaceId: string, opts: { ensure?: boolean } = {}): Promise<Access | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, agencyRole: true, isAgencyAdmin: true, active: true } });
  if (!user || !user.active) return null;
  const teamUserIds = await teamMatesOf(userId, workspaceId);
  if (isAgencyStaff(user)) return { userId, workspaceId, roleKey: "agency", perms: FULL, teamUserIds };
  if (opts.ensure !== false) await ensureRoles(workspaceId);
  const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, include: { roleRef: true } });
  if (!m) return null;
  if (!m.roleRef) return { userId, workspaceId, roleKey: "nurlesen", perms: PRESETS.nurlesen.permissions, teamUserIds };
  return { userId, workspaceId, roleKey: m.roleRef.key, perms: parsePermissions(m.roleRef.permissions), teamUserIds };
}

/** Akteur-Kennung (user:<id> bzw. oauth:…:user:<id>) → Benutzer-ID oder null. */
export function userIdFromActor(actor: string): string | null {
  const m = /(?:^|:)user:([^:]+)$/.exec(actor);
  return m ? m[1] : null;
}

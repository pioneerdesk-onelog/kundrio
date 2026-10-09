import { OBJECT_KEYS, OBJECTS, SPECIAL_KEYS, scopeRank, type Permissions } from "./catalog";

// Schutz vor Rechte-Eskalation: Wer nicht Agentur-Staff ist, darf nur Rollen vergeben bzw.
// Rechte setzen, die er selbst mindestens hat.

/** true, wenn `a` in jeder Hinsicht höchstens so viel erlaubt wie `b`. */
export function isSubset(a: Permissions, b: Permissions): boolean {
  for (const k of OBJECT_KEYS) {
    for (const act of ["read", "edit", "delete"] as const) {
      if (scopeRank(a.objects[k][act]) > scopeRank(b.objects[k][act])) return false;
    }
  }
  for (const s of SPECIAL_KEYS) if (a.special[s] && !b.special[s]) return false;
  return true;
}

/** Objekte ohne Zuständige kennen nur keine/alle: own/team → none (sonst stilles „kein Recht“). */
export function normalizePermissions(p: Permissions): Permissions {
  const objects = { ...p.objects };
  for (const k of OBJECT_KEYS) {
    if (OBJECTS[k].owned) continue;
    const o = objects[k];
    const fix = (s: (typeof o)["read"]) => (s === "own" || s === "team" ? "none" : s);
    objects[k] = { read: fix(o.read), edit: fix(o.edit), delete: fix(o.delete) };
  }
  return { objects, special: { ...p.special } };
}

export type AgencyRole = "owner" | "admin" | "member";

/**
 * Regeln für Änderungen an Agentur-Rollen bzw. Deaktivierung.
 * Gibt eine verständliche Fehlermeldung zurück oder null, wenn erlaubt.
 */
export function checkAgencyChange(input: {
  actorId: string;
  actorRole: AgencyRole;
  targetId: string;
  targetRole: AgencyRole;
  /** neue Rolle; null = Deaktivierung */
  newRole: AgencyRole | null;
  /** Anzahl aktiver Inhaber (inkl. Ziel, falls Inhaber) */
  activeOwners: number;
}): string | null {
  const { actorId, actorRole, targetId, targetRole, newRole, activeOwners } = input;
  if (actorRole === "member") return "Nur Inhaber oder Admins der Agentur verwalten Benutzer.";
  if (actorId === targetId) return "Die eigene Agentur-Rolle bzw. das eigene Konto kann nicht geändert werden.";
  const privileged = (r: AgencyRole | null) => r === "owner" || r === "admin";
  if ((privileged(targetRole) || privileged(newRole)) && actorRole !== "owner") {
    return "Nur Inhaber dürfen Inhaber- und Admin-Rollen vergeben oder ändern.";
  }
  if (targetRole === "owner" && newRole !== "owner" && activeOwners <= 1) {
    return "Der letzte Inhaber kann nicht herabgestuft oder deaktiviert werden.";
  }
  return null;
}

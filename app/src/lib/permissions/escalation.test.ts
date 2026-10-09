import { describe, expect, it } from "vitest";
import { FULL, PRESETS, parsePermissions } from "./catalog";
import { checkAgencyChange, isSubset, normalizePermissions } from "./escalation";

describe("isSubset (Eskalationsschutz)", () => {
  it("jede Rolle ist Teilmenge von Admin", () => {
    for (const p of Object.values(PRESETS)) expect(isSubset(p.permissions, FULL)).toBe(true);
  });
  it("Vertrieb darf keine Teamleitung vergeben", () => {
    expect(isSubset(PRESETS.teamleitung.permissions, PRESETS.vertrieb.permissions)).toBe(false);
  });
  it("Sonderrecht Export zählt", () => {
    const withExport = parsePermissions({ ...PRESETS.nurlesen.permissions, special: { ...PRESETS.nurlesen.permissions.special, export: true } });
    expect(isSubset(withExport, PRESETS.nurlesen.permissions)).toBe(false);
    expect(isSubset(PRESETS.nurlesen.permissions, withExport)).toBe(true);
  });
  it("Reichweite eigene ⊂ Team ⊂ alle", () => {
    const own = parsePermissions({ objects: { contacts: { read: "own", edit: "none", delete: "none" } } });
    const team = parsePermissions({ objects: { contacts: { read: "team", edit: "none", delete: "none" } } });
    expect(isSubset(own, team)).toBe(true);
    expect(isSubset(team, own)).toBe(false);
  });
  it("normalize: own/team bei Objekten ohne Zuständige → keine", () => {
    const p = normalizePermissions(parsePermissions({ objects: { lists: { read: "team", edit: "own", delete: "all" }, contacts: { read: "team", edit: "own", delete: "none" } } }));
    expect(p.objects.lists).toEqual({ read: "none", edit: "none", delete: "all" });
    expect(p.objects.contacts.read).toBe("team");
  });
});

describe("checkAgencyChange", () => {
  const base = { actorId: "a", targetId: "b", activeOwners: 2 } as const;
  it("Mitglieder verwalten niemanden", () => {
    expect(checkAgencyChange({ ...base, actorRole: "member", targetRole: "member", newRole: "admin" })).toMatch(/Nur Inhaber oder Admins/);
  });
  it("niemand ändert sich selbst", () => {
    expect(checkAgencyChange({ ...base, targetId: "a", actorRole: "owner", targetRole: "owner", newRole: "admin" })).toMatch(/eigene/);
  });
  it("Admin darf keine Admins ernennen, aber Mitglieder deaktivieren", () => {
    expect(checkAgencyChange({ ...base, actorRole: "admin", targetRole: "member", newRole: "admin" })).toMatch(/Nur Inhaber/);
    expect(checkAgencyChange({ ...base, actorRole: "admin", targetRole: "member", newRole: null })).toBeNull();
    expect(checkAgencyChange({ ...base, actorRole: "admin", targetRole: "owner", newRole: null })).toMatch(/Nur Inhaber/);
  });
  it("der letzte Inhaber bleibt", () => {
    expect(checkAgencyChange({ ...base, actorRole: "owner", targetRole: "owner", newRole: "admin", activeOwners: 1 })).toMatch(/letzte Inhaber/);
    expect(checkAgencyChange({ ...base, actorRole: "owner", targetRole: "owner", newRole: null, activeOwners: 1 })).toMatch(/letzte Inhaber/);
    expect(checkAgencyChange({ ...base, actorRole: "owner", targetRole: "owner", newRole: "admin", activeOwners: 2 })).toBeNull();
  });
});

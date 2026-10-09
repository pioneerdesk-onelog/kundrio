import { describe, expect, it } from "vitest";
import { FULL, PRESETS, allows, intersect, parsePermissions, PRESET_KEYS } from "./catalog";

const me = "u1";
describe("Rollenvorlagen", () => {
  it("alle Vorlagen sind gültig und vollständig", () => {
    for (const k of PRESET_KEYS) expect(parsePermissions(PRESETS[k].permissions)).toEqual(PRESETS[k].permissions);
  });
  it("Admin darf alles inkl. Sonderrechte", () => {
    expect(allows(FULL, "contacts", "delete", { userId: me, recordOwnerId: "x" })).toBe(true);
    expect(Object.values(FULL.special).every(Boolean)).toBe(true);
  });
  it("Nur lesen exportiert nicht und ändert nichts", () => {
    const p = PRESETS.nurlesen.permissions;
    expect(p.special.export).toBe(false);
    expect(allows(p, "deals", "edit", { userId: me })).toBe(false);
    expect(allows(p, "deals", "read", { userId: me, recordOwnerId: "x" })).toBe(true);
  });
});

describe("Reichweite eigene/Team", () => {
  const vertrieb = PRESETS.vertrieb.permissions;
  it("Vertrieb bearbeitet eigene und unzugewiesene Kontakte, aber keine fremden", () => {
    expect(allows(vertrieb, "contacts", "edit", { userId: me, recordOwnerId: me })).toBe(true);
    expect(allows(vertrieb, "contacts", "edit", { userId: me, recordOwnerId: null })).toBe(true);
    expect(allows(vertrieb, "contacts", "edit", { userId: me, recordOwnerId: "fremd" })).toBe(false);
  });
  it("Team-Lesen umfasst Teamkollegen, nicht Fremde", () => {
    expect(allows(vertrieb, "contacts", "read", { userId: me, recordOwnerId: "kollege", teamUserIds: [me, "kollege"] })).toBe(true);
    expect(allows(vertrieb, "contacts", "read", { userId: me, recordOwnerId: "fremd", teamUserIds: [me, "kollege"] })).toBe(false);
  });
  it("own/team gilt bei Objekten ohne Zuständige als kein Recht", () => {
    const p = parsePermissions({ objects: { lists: { read: "own", edit: "own", delete: "none" } } });
    expect(allows(p, "lists", "read", { userId: me })).toBe(false);
  });
});

describe("Schnittmenge (OAuth ∩ Benutzer)", () => {
  it("nimmt je Recht das Minimum", () => {
    const r = intersect(FULL, PRESETS.vertrieb.permissions);
    expect(r).toEqual(PRESETS.vertrieb.permissions);
    expect(intersect(PRESETS.marketing.permissions, PRESETS.buchhaltung.permissions).special.export).toBe(false);
  });
});

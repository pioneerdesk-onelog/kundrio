import { describe, expect, it } from "vitest";
import { PRESETS, FULL } from "./catalog";
import { actorIsUser, canSetOwner, fourEyesBlocks } from "./rules";

const ctx = { userId: "me", teamUserIds: ["me", "kollege"] };

describe("canSetOwner", () => {
  it("alle-Reichweite darf beliebig zuweisen", () => {
    expect(canSetOwner(FULL, "contacts", ctx, "fremd")).toBe(true);
  });
  it("eigene-Reichweite: nur sich selbst oder niemand", () => {
    const p = PRESETS.vertrieb.permissions; // contacts.edit = own
    expect(canSetOwner(p, "contacts", ctx, "me")).toBe(true);
    expect(canSetOwner(p, "contacts", ctx, null)).toBe(true);
    expect(canSetOwner(p, "contacts", ctx, "kollege")).toBe(false);
  });
  it("Team-Reichweite: Teamkollegen ja, Fremde nein", () => {
    const p = structuredClone(PRESETS.vertrieb.permissions);
    p.objects.deals.edit = "team";
    expect(canSetOwner(p, "deals", ctx, "kollege")).toBe(true);
    expect(canSetOwner(p, "deals", ctx, "fremd")).toBe(false);
  });
  it("ohne Bearbeiten-Recht nie", () => {
    expect(canSetOwner(PRESETS.nurlesen.permissions, "contacts", ctx, "me")).toBe(false);
  });
});

describe("Vier-Augen", () => {
  it("erkennt Benutzer- und OAuth-Akteure", () => {
    expect(actorIsUser("user:me", "me")).toBe(true);
    expect(actorIsUser("oauth:tok1:user:me", "me")).toBe(true);
    expect(actorIsUser("mcp:key1", "me")).toBe(false);
    expect(actorIsUser("user:mehr", "me")).toBe(false);
  });
  it("blockiert nur bei eingeschaltetem Vier-Augen und eigenem Antrag", () => {
    expect(fourEyesBlocks(true, "user:me", "me")).toBe(true);
    expect(fourEyesBlocks(false, "user:me", "me")).toBe(false);
    expect(fourEyesBlocks(true, "user:jemand", "me")).toBe(false);
    expect(fourEyesBlocks(true, "process:run1", "me")).toBe(false);
  });
});

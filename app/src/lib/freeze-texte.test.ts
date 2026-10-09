import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { formatDay, plural } from "./a-format";
import { SCOPES } from "./apikey";
import { SCOPE_LABEL } from "./apikey-labels";

// Erkundungstest Freeze (Rollen/A11y, 2026-10-07): Texte und Formate, die im Bild auffielen.
describe("Texte & Formate (Erkundungstest)", () => {
  it("Diagramm-Legende zeigt deutsches Datum statt ISO", () => {
    expect(formatDay("2026-09-08")).toBe("08.09.2026");
    expect(formatDay("2026-10-07T12:00:00Z")).toBe("07.10.2026");
    expect(formatDay("KW 41")).toBe("KW 41");
  });

  it("Einzahl/Mehrzahl mit Tausenderpunkt („1 Deal“ statt „1 Deals“)", () => {
    expect(plural(1, "Deal", "Deals")).toBe("1 Deal");
    expect(plural(0, "Deal", "Deals")).toBe("0 Deals");
    expect(plural(12500, "Lauf", "Läufe")).toBe("12.500 Läufe");
  });

  it("jede API-Berechtigung hat eine deutsche Beschreibung (nicht „mcp:read – mcp:read“)", () => {
    for (const s of SCOPES) expect(SCOPE_LABEL[s], s).toBeTruthy();
  });
});

// Öffentliches Repo 2026-10-09: Agenturname war im Code fest „Pioneerdesk GmbH“ – in fremden Installationen falsch.
describe("Agenturname aus der Datenbank", () => {
  it("weder Übersicht noch Einladungsmail nennen einen festen Firmennamen", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/app/(admin)/page.tsx", "src/lib/invitations.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/Pioneerdesk GmbH/);
    }
  });
});

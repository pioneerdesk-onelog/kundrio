import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ALL_TOOLS, listTools: listToolsCtx, requiredScope, auditArgs } = await import("./tools");
const { processSchemaCatalog } = await import("./tools-process");
const { scopeCeiling, effectivePerms } = await import("./context");
const { PRESETS } = await import("../permissions/catalog");
type Ctx = Parameters<typeof listToolsCtx>[0];

/** Kontext eines API-Schlüssels mit den gegebenen Scopes */
function keyCtx(scopes: string[]): Ctx {
  return { workspaceId: "w", workspaceSlug: "w", workspaceName: "W", keyId: "k", scopes, actor: "mcp:k", authKind: "apikey", userId: null, perms: scopeCeiling(scopes), teamUserIds: [] };
}
const listTools = (scopes: string[]) => listToolsCtx(keyCtx(scopes));

describe("Admin-MCP-Werkzeuge", () => {
  it("hat eindeutige, gültige Namen", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it("enthält alle geforderten Werkzeuge", () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name));
    for (const n of [
      "search_contacts", "get_contact", "search_companies", "get_company", "list_deals", "get_deal", "list_tickets", "get_ticket",
      "list_pipelines", "list_lifecycle_stages", "list_properties", "list_lists", "get_activity_timeline", "list_processes", "get_process",
      "list_process_runs", "get_process_run", "list_templates", "describe_process_schema", "analytics_summary", "create_contact", "update_contact",
      "create_company", "update_company", "create_deal", "move_deal_stage", "create_ticket", "update_ticket", "add_note", "create_task",
      "add_to_list", "create_process", "update_process_draft", "validate_process", "test_process", "enroll_in_process", "publish_process",
      "send_email", "delete_contact", "set_process_status",
    ]) expect(names.has(n), n).toBe(true);
  });

  it("erzeugt für jedes Werkzeug ein Objekt-JSON-Schema", () => {
    const listed = listTools(["mcp:read", "mcp:write"]);
    expect(listed).toHaveLength(ALL_TOOLS.length);
    for (const t of listed) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.description.length, t.name).toBeGreaterThan(20);
    }
  });

  it("setzt Annotationen passend zur Wirkung", () => {
    const listed = listTools(["mcp:read", "mcp:write"]);
    const get = (n: string) => listed.find((t) => t.name === n)!;
    expect(get("search_contacts").annotations.readOnlyHint).toBe(true);
    expect(get("create_contact").annotations.readOnlyHint).toBe(false);
    expect(get("delete_contact").annotations.destructiveHint).toBe(true);
    expect(get("send_email").description).toMatch(/Freigabe/);
  });

  it("zeigt mit reinem Lesezugriff nur Lese-Werkzeuge", () => {
    const listed = listTools(["mcp:read"]);
    expect(listed.length).toBeGreaterThan(10);
    for (const t of listed) expect(t.annotations.readOnlyHint, t.name).toBe(true);
    expect(listTools(["mail:send"])).toHaveLength(0);
  });

  it("verlangt mcp:write für Änderungen und Freigabe-Anträge", () => {
    for (const t of ALL_TOOLS) expect(requiredScope(t)).toBe(t.access === "read" ? "mcp:read" : "mcp:write");
  });

  it("schreibt ins Audit-Log nur Schlüssel und IDs, keine Inhalte", () => {
    const a = auditArgs({ contact: "max@example.com", subject: "Geheim", body: "Inhalt", processId: "p1", status: "ACTIVE" });
    expect(a).toEqual({ keys: ["contact", "subject", "body", "processId", "status"], processId: "p1", status: "ACTIVE" });
    expect(JSON.stringify(a)).not.toMatch(/max@example|Geheim|Inhalt/);
  });

  it("validiert Argumente streng", () => {
    const t = ALL_TOOLS.find((x) => x.name === "create_task")!;
    expect(t.input.safeParse({ title: "" }).success).toBe(false);
    expect(t.input.safeParse({ title: "Anrufen", dueInDays: 2 }).success).toBe(true);
    const s = ALL_TOOLS.find((x) => x.name === "search_contacts")!;
    expect(s.input.safeParse({ limit: 500 }).success).toBe(false);
  });

  it("liefert einen vollständigen Prozess-Bauplan mit gültigem Beispiel", async () => {
    const cat = processSchemaCatalog();
    expect(cat.nodeTypes.length).toBeGreaterThan(15);
    for (const n of cat.nodeTypes) expect((n.config as { type?: string }).type).toBe("object");
    const { validateDefinition } = await import("../process/definition");
    const v = validateDefinition(cat.beispiel, "contact");
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(() => JSON.stringify(cat)).not.toThrow();
  });

  it("jedes Werkzeug hat eine Rechte-Angabe", () => {
    for (const t of ALL_TOOLS) expect(t.perm === null || typeof t.perm === "object", t.name).toBe(true);
  });

  it("OAuth: Werkzeugliste folgt der Rolle des Benutzers", () => {
    const ctx: Ctx = { ...keyCtx(["mcp:read", "mcp:write"]), authKind: "oauth", userId: "u1", perms: effectivePerms(PRESETS.buchhaltung.permissions, ["mcp:read", "mcp:write"]) };
    const names = listToolsCtx(ctx).map((t) => t.name);
    expect(names).toContain("search_contacts");
    expect(names).not.toContain("create_contact");
    expect(names).not.toContain("create_process");
    expect(names).not.toContain("analytics_summary");
  });

  it("API-Schlüssel bekommen nie Sonderrechte (z. B. Export)", () => {
    expect(scopeCeiling(["mcp:read", "mcp:write"]).special.export).toBe(false);
    expect(scopeCeiling(["mcp:read"]).objects.contacts.edit).toBe("none");
  });
});

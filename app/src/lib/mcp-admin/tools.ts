import "server-only";
import { z } from "zod";
import { audit } from "../audit";
import { crmTools } from "./tools-crm";
import { processTools } from "./tools-process";
import { docTools } from "./tools-docs";
import { McpToolError, canDo, type McpCtx, type ToolDef } from "./context";
import type { ToolResult } from "./protocol";
import { errMessage, log } from "@/lib/log";

// Werkzeugkatalog des Admin-MCP: Liste (JSON-Schema aus zod), Berechtigungsprüfung, Ausführung, Audit.

export const ALL_TOOLS: ToolDef[] = [...crmTools, ...processTools, ...docTools] as unknown as ToolDef[];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function requiredScope(t: ToolDef) {
  return t.access === "read" ? "mcp:read" : "mcp:write";
}

/** Grobe Rechteprüfung (ohne konkreten Datensatz). */
export function permitted(t: ToolDef, ctx: McpCtx) {
  if (!t.perm) return true;
  const objects = "anyOf" in t.perm ? t.perm.anyOf : [t.perm.object];
  return objects.some((o) => canDo(ctx, o, t.perm!.action));
}

export function getTool(name: string) {
  return byName.get(name);
}

/** Werkzeuge für tools/list – nur die, für die Umfang und Rechte reichen. */
export function listTools(ctx: McpCtx) {
  return ALL_TOOLS.filter((t) => ctx.scopes.includes(requiredScope(t)) && permitted(t, ctx)).map((t) => {
    const schema = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      title: t.title,
      description:
        t.access === "approval" ? `${t.description} (Erfordert menschliche Freigabe im CRM.)` : t.description,
      inputSchema: schema,
      annotations: {
        title: t.title,
        readOnlyHint: t.access === "read",
        destructiveHint: Boolean(t.destructive),
        idempotentHint: t.access === "read" || Boolean(t.idempotent),
        openWorldHint: false,
      },
    };
  });
}

/** Argumente fürs Audit-Log: nur Schlüssel + IDs, keine Inhalte (keine personenbezogenen Daten). */
export function auditArgs(args: Record<string, unknown>) {
  const out: Record<string, unknown> = { keys: Object.keys(args).slice(0, 30) };
  for (const [k, v] of Object.entries(args)) {
    if (/(^id$|Id$)/.test(k) && (typeof v === "string" || typeof v === "number")) out[k] = String(v).slice(0, 60);
    if ((k === "status" || k === "objectType" || k === "templateKey" || k === "stageKind") && typeof v === "string") out[k] = v.slice(0, 40);
  }
  return out;
}

const text = (data: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  structuredContent: !isError && typeof data === "object" && data !== null ? data : undefined,
  isError,
});

export async function callAdminTool(name: string, args: Record<string, unknown>, ctx: McpCtx): Promise<ToolResult | null> {
  const t = byName.get(name);
  if (!t) return null;
  const scope = requiredScope(t);
  const started = Date.now();
  let outcome = "ok";
  try {
    if (!ctx.scopes.includes(scope)) {
      outcome = "forbidden";
      return text(`Dieser Zugang hat keinen Umfang „${scope}“ für ${name}.`, true);
    }
    if (!permitted(t, ctx)) {
      outcome = "forbidden";
      return text(`Keine Berechtigung für ${name}: Die Rolle des Benutzers bzw. der Umfang des Zugangs erlaubt das nicht.`, true);
    }
    // Unbekannte Felder nicht still verwerfen: LLMs brauchen eine klare Rückmeldung über gültige Feldnamen
    const shape = (t.input as unknown as { shape?: Record<string, unknown> }).shape;
    if (shape && args && typeof args === "object" && !Array.isArray(args)) {
      const unknown = Object.keys(args).filter((k) => !(k in shape));
      if (unknown.length) {
        outcome = "invalid";
        return text(`Unbekannte Felder: ${unknown.join(", ")}. Gültige Felder: ${Object.keys(shape).join(", ")}.`, true);
      }
    }
    const parsed = t.input.safeParse(args);
    if (!parsed.success) {
      outcome = "invalid";
      return text(`Ungültige Argumente: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(Wurzel)"}: ${i.message}`).join("; ")}`, true);
    }
    const result = await t.run(parsed.data, ctx);
    return text(result);
  } catch (e) {
    if (e instanceof McpToolError) {
      outcome = "error";
      return text(e.message, true);
    }
    outcome = "internal_error";
    log.error("admin mcp tool error", { tool: name, error: errMessage(e) });
    return text("Interner Fehler. Bitte später erneut versuchen.", true);
  } finally {
    await audit({
      workspaceId: ctx.workspaceId,
      actor: ctx.actor,
      action: `mcp.${name}`,
      target: typeof args.contact === "string" && !args.contact.includes("@") ? args.contact : undefined,
      detail: { ...auditArgs(args), outcome, ms: Date.now() - started },
    });
  }
}

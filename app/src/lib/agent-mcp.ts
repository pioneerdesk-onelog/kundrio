import "server-only";
import { db } from "./db";
import { env } from "./env";
import { AgentError, agentAsk, agentInfo, agentRequest, type PublicWorkspace } from "./agent-core";
import { errMessage, log } from "@/lib/log";

// Minimaler, zustandsloser MCP-Server (Streamable HTTP, nur JSON-Antworten).
// Modern: Revision 2026-07-28 (Metadaten pro Anfrage, server/discover, Header-Prüfung).
// Legacy: initialize-Handshake (2025-11-25 und älter) wird zustandslos beantwortet, ohne Session-IDs.

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const META = "io.modelcontextprotocol/";
const SERVER_INFO = { name: "kundrio-agent", version: "1.0.0" };

type RpcId = string | number;
type RpcRequest = { jsonrpc: "2.0"; id?: RpcId; method: string; params?: Record<string, unknown> };

const TOOLS = [
  {
    name: "get_info",
    title: "Profil abrufen",
    description: "Liefert Profil, Website, Sprachen und Grundsätze des Anbieters.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "ask",
    title: "Frage stellen",
    description: "Beantwortet eine Frage ausschließlich aus veröffentlichten Informationen des Anbieters (KI-generiert, mit Quellen).",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 3, maxLength: 1000, description: "Die Frage in natürlicher Sprache" },
        language: { type: "string", description: "Antwortsprache, z. B. de oder en" },
      },
      required: ["question"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "request_contact",
    title: "Anfrage übermitteln",
    description:
      "Übermittelt eine Kontakt-, Termin- oder Angebotsanfrage im Auftrag des Nutzers. Ein Mensch bearbeitet sie; es werden keine Zusagen erteilt. Nur mit Zustimmung des Nutzers verwenden.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["contact", "appointment", "quote"] },
        name: { type: "string", maxLength: 200 },
        email: { type: "string", format: "email" },
        phone: { type: "string", maxLength: 40 },
        company: { type: "string", maxLength: 200 },
        message: { type: "string", minLength: 5, maxLength: 4000 },
        preferredTimes: { type: "string", maxLength: 500 },
      },
      required: ["name", "email", "message"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

function res(status: number, body: unknown) {
  if (body === null) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
const rpcError = (id: RpcId | undefined, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  ...(id !== undefined ? { id } : {}),
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

/** Origin-Prüfung gegen DNS-Rebinding: nur eigene App, Projekt-Domain und freigegebene Domains. */
async function originAllowed(ws: PublicWorkspace, origin: string | null) {
  if (!origin) return true; // Agenten/Server senden keinen Origin
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const full = await db.workspace.findUnique({ where: { id: ws.id }, select: { allowedOrigins: true } });
  const allowed = new Set<string>([new URL(env.appUrl()).host.toLowerCase()]);
  if (ws.domain) {
    allowed.add(ws.domain.toLowerCase());
    allowed.add(`www.${ws.domain.toLowerCase()}`);
  }
  for (const o of full?.allowedOrigins ?? []) {
    try {
      allowed.add(new URL(o.includes("://") ? o : `https://${o}`).host.toLowerCase());
    } catch {
      /* ungültige Einträge ignorieren */
    }
  }
  return allowed.has(host);
}

function decodeHeader(v: string | null) {
  if (v && v.startsWith("=?base64?") && v.endsWith("?=")) {
    return Buffer.from(v.slice(9, -2), "base64").toString("utf8");
  }
  return v;
}

async function callTool(ws: PublicWorkspace, name: string, args: Record<string, unknown>, headers: Headers) {
  const text = (data: unknown) => ({
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    structuredContent: typeof data === "object" && data !== null ? data : undefined,
    isError: false,
  });
  try {
    if (name === "get_info") return text(await agentInfo(ws));
    if (name === "ask") return text(await agentAsk(ws, args, headers));
    if (name === "request_contact") return text(await agentRequest(ws, args, headers, `/api/agent/${ws.slug}/mcp`));
  } catch (err) {
    const msg = err instanceof AgentError ? err.message : "Interner Fehler. Bitte später erneut versuchen.";
    if (!(err instanceof AgentError)) log.error("agent mcp tool error", { error: errMessage(err) });
    return { content: [{ type: "text", text: msg }], isError: true };
  }
  return null;
}

function instructions(ws: PublicWorkspace) {
  return `Auskunftsdienst von ${ws.name}${ws.domain ? ` (${ws.domain})` : ""}. Nutze ask für Fragen zu Angebot und Leistungen; Antworten sind KI-generiert und stammen nur aus veröffentlichten Informationen. Nutze request_contact nur mit Zustimmung des Nutzers.`;
}

export async function handleMcp(req: Request, ws: PublicWorkspace): Promise<Response> {
  if (!(await originAllowed(ws, req.headers.get("origin")))) return res(403, rpcError(undefined, -32600, "Origin nicht erlaubt"));

  let msg: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 32 * 1024) return res(413, rpcError(undefined, -32600, "Anfrage zu groß"));
    msg = JSON.parse(raw);
  } catch {
    return res(400, rpcError(undefined, -32700, "Parse error"));
  }
  if (Array.isArray(msg) || typeof msg !== "object" || msg === null) return res(400, rpcError(undefined, -32600, "Invalid Request"));
  const m = msg as RpcRequest;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return res(400, rpcError(m.id, -32600, "Invalid Request"));
  if (m.id === undefined || m.id === null) return res(202, null); // Notification
  if (typeof m.id !== "string" && typeof m.id !== "number") return res(400, rpcError(undefined, -32600, "Invalid Request"));

  const params = (m.params ?? {}) as Record<string, unknown>;
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const requested = meta[`${META}protocolVersion`];
  const headerVersion = req.headers.get("mcp-protocol-version");

  // ---------- Legacy-Clients (initialize-Handshake) ----------
  if (requested === undefined && (m.method === "initialize" || !headerVersion || LEGACY_VERSIONS.includes(headerVersion))) {
    switch (m.method) {
      case "initialize": {
        const want = String(params.protocolVersion ?? "");
        return res(200, {
          jsonrpc: "2.0",
          id: m.id,
          result: {
            protocolVersion: LEGACY_VERSIONS.includes(want) ? want : LEGACY_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
            instructions: instructions(ws),
          },
        });
      }
      case "ping":
        return res(200, { jsonrpc: "2.0", id: m.id, result: {} });
      case "tools/list":
        return res(200, { jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
      case "tools/call": {
        const r = await callTool(ws, String(params.name ?? ""), (params.arguments ?? {}) as Record<string, unknown>, req.headers);
        if (!r) return res(200, rpcError(m.id, -32602, `Unbekanntes Tool: ${String(params.name)}`));
        return res(200, { jsonrpc: "2.0", id: m.id, result: r });
      }
      default:
        return res(200, rpcError(m.id, -32601, "Method not found"));
    }
  }

  // ---------- Modern (2026-07-28): Metadaten pro Anfrage ----------
  if (typeof requested !== "string" || typeof meta[`${META}clientCapabilities`] !== "object") {
    return res(400, rpcError(m.id, -32602, "Invalid params: _meta protocolVersion und clientCapabilities sind Pflicht"));
  }
  if (!MODERN_VERSIONS.includes(requested)) {
    return res(400, rpcError(m.id, -32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested }));
  }
  if (headerVersion !== requested) return res(400, rpcError(m.id, -32020, "Header mismatch: MCP-Protocol-Version"));
  if (req.headers.get("mcp-method") !== m.method) return res(400, rpcError(m.id, -32020, "Header mismatch: Mcp-Method"));
  if (m.method === "tools/call" && decodeHeader(req.headers.get("mcp-name")) !== params.name) {
    return res(400, rpcError(m.id, -32020, "Header mismatch: Mcp-Name"));
  }

  const resultMeta = { [`${META}serverInfo`]: SERVER_INFO };
  switch (m.method) {
    case "server/discover":
      return res(200, {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          resultType: "complete",
          supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
          capabilities: { tools: {} },
          instructions: instructions(ws),
          _meta: resultMeta,
        },
      });
    case "ping":
      return res(200, { jsonrpc: "2.0", id: m.id, result: { resultType: "complete", _meta: resultMeta } });
    case "tools/list":
      return res(200, { jsonrpc: "2.0", id: m.id, result: { resultType: "complete", tools: TOOLS, _meta: resultMeta } });
    case "tools/call": {
      const r = await callTool(ws, String(params.name ?? ""), (params.arguments ?? {}) as Record<string, unknown>, req.headers);
      if (!r) return res(400, rpcError(m.id, -32602, `Unbekanntes Tool: ${String(params.name)}`));
      return res(200, { jsonrpc: "2.0", id: m.id, result: { resultType: "complete", ...r, _meta: resultMeta } });
    }
    default:
      return res(404, rpcError(m.id, -32601, "Method not found"));
  }
}

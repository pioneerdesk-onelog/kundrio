import "server-only";

// Zustandsloser MCP-Server (Streamable HTTP, nur JSON-Antworten) – gleiches Protokollverhalten wie
// der öffentliche Agent-MCP (src/lib/agent-mcp.ts): Revision 2026-07-28 mit Metadaten pro Anfrage
// sowie Legacy-initialize (2025-11-25 und älter) ohne Session-IDs.

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const META = "io.modelcontextprotocol/";

export type RpcId = string | number;
type RpcRequest = { jsonrpc: "2.0"; id?: RpcId; method: string; params?: Record<string, unknown> };

export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError: boolean };

export type McpServer = {
  serverInfo: { name: string; version: string };
  instructions: string;
  tools: unknown[];
  /** null = unbekanntes Tool */
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult | null>;
  maxBytes?: number;
};

export function json(status: number, body: unknown) {
  if (body === null) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const rpcError = (id: RpcId | undefined, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  ...(id !== undefined ? { id } : {}),
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

function decodeHeader(v: string | null) {
  if (v && v.startsWith("=?base64?") && v.endsWith("?=")) return Buffer.from(v.slice(9, -2), "base64").toString("utf8");
  return v;
}

export async function parseRpc(req: Request, maxBytes: number): Promise<{ msg: RpcRequest } | { response: Response }> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { response: json(400, rpcError(undefined, -32700, "Parse error")) };
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) return { response: json(413, rpcError(undefined, -32600, "Anfrage zu groß")) };
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { response: json(400, rpcError(undefined, -32700, "Parse error")) };
  }
  if (Array.isArray(msg) || typeof msg !== "object" || msg === null) return { response: json(400, rpcError(undefined, -32600, "Invalid Request")) };
  const m = msg as RpcRequest;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return { response: json(400, rpcError(m.id, -32600, "Invalid Request")) };
  return { msg: m };
}

/** Beantwortet eine bereits geparste JSON-RPC-Nachricht. */
export async function dispatch(req: Request, m: RpcRequest, server: McpServer): Promise<Response> {
  if (m.id === undefined || m.id === null) return json(202, null); // Notification
  if (typeof m.id !== "string" && typeof m.id !== "number") return json(400, rpcError(undefined, -32600, "Invalid Request"));

  const params = (m.params ?? {}) as Record<string, unknown>;
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const requested = meta[`${META}protocolVersion`];
  const headerVersion = req.headers.get("mcp-protocol-version");
  const toolName = String(params.name ?? "");
  const toolArgs = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;

  // ---------- Legacy-Clients (initialize-Handshake) ----------
  if (requested === undefined && (m.method === "initialize" || !headerVersion || LEGACY_VERSIONS.includes(headerVersion))) {
    switch (m.method) {
      case "initialize": {
        const want = String(params.protocolVersion ?? "");
        return json(200, {
          jsonrpc: "2.0",
          id: m.id,
          result: {
            protocolVersion: LEGACY_VERSIONS.includes(want) ? want : LEGACY_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: server.serverInfo,
            instructions: server.instructions,
          },
        });
      }
      case "ping":
        return json(200, { jsonrpc: "2.0", id: m.id, result: {} });
      case "tools/list":
        return json(200, { jsonrpc: "2.0", id: m.id, result: { tools: server.tools } });
      case "tools/call": {
        const r = await server.callTool(toolName, toolArgs);
        if (!r) return json(200, rpcError(m.id, -32602, `Unbekanntes Tool: ${toolName}`));
        return json(200, { jsonrpc: "2.0", id: m.id, result: r });
      }
      default:
        return json(200, rpcError(m.id, -32601, "Method not found"));
    }
  }

  // ---------- Modern (2026-07-28): Metadaten pro Anfrage ----------
  if (typeof requested !== "string" || typeof meta[`${META}clientCapabilities`] !== "object") {
    return json(400, rpcError(m.id, -32602, "Invalid params: _meta protocolVersion und clientCapabilities sind Pflicht"));
  }
  if (!MODERN_VERSIONS.includes(requested)) {
    return json(400, rpcError(m.id, -32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested }));
  }
  if (headerVersion !== requested) return json(400, rpcError(m.id, -32020, "Header mismatch: MCP-Protocol-Version"));
  if (req.headers.get("mcp-method") !== m.method) return json(400, rpcError(m.id, -32020, "Header mismatch: Mcp-Method"));
  if (m.method === "tools/call" && decodeHeader(req.headers.get("mcp-name")) !== params.name) {
    return json(400, rpcError(m.id, -32020, "Header mismatch: Mcp-Name"));
  }

  const resultMeta = { [`${META}serverInfo`]: server.serverInfo };
  switch (m.method) {
    case "server/discover":
      return json(200, {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          resultType: "complete",
          supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS],
          capabilities: { tools: {} },
          instructions: server.instructions,
          _meta: resultMeta,
        },
      });
    case "ping":
      return json(200, { jsonrpc: "2.0", id: m.id, result: { resultType: "complete", _meta: resultMeta } });
    case "tools/list":
      return json(200, { jsonrpc: "2.0", id: m.id, result: { resultType: "complete", tools: server.tools, _meta: resultMeta } });
    case "tools/call": {
      const r = await server.callTool(toolName, toolArgs);
      if (!r) return json(400, rpcError(m.id, -32602, `Unbekanntes Tool: ${toolName}`));
      return json(200, { jsonrpc: "2.0", id: m.id, result: { resultType: "complete", ...r, _meta: resultMeta } });
    }
    default:
      return json(404, rpcError(m.id, -32601, "Method not found"));
  }
}

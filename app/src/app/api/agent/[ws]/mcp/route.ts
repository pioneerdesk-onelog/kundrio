import { getPublicWorkspace } from "@/lib/agent-core";
import { handleMcp } from "@/lib/agent-mcp";

export const dynamic = "force-dynamic";

// MCP-Endpunkt (Streamable HTTP, zustandslos). GET/DELETE gibt es in Revision 2026-07-28 nicht mehr.
export async function POST(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  const ws = await getPublicWorkspace((await params).ws);
  if (!ws) return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "Unbekannt" } }), { status: 404, headers: { "content-type": "application/json" } });
  try {
    return await handleMcp(req, ws);
  } catch (err) {
    console.error("MCP-Fehler", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" } }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;

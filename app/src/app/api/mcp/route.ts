import { handleAdminMcp } from "@/lib/mcp-admin/server";

// Admin-MCP-Endpunkt (Streamable HTTP, zustandslos). Anleitung: Sub-Account → API & Schnittstellen → MCP.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleAdminMcp(req);
}

// Kein SSE-Stream: dieser Server antwortet ausschließlich mit JSON
export async function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

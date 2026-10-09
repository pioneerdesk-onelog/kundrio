import { agentRequest, getPublicWorkspace } from "@/lib/agent-core";
import { errorResponse, json, preflight, readJson } from "@/lib/agent-http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ws = await getPublicWorkspace((await params).ws);
    if (!ws) return json({ error: "Unbekannt" }, 404);
    const result = await agentRequest(ws, await readJson(req), req.headers, `/api/agent/${ws.slug}/request`);
    return json(result, 202);
  } catch (e) {
    return errorResponse(e);
  }
}

export const OPTIONS = preflight;

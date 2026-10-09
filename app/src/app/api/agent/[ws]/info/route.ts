import { agentInfo, getPublicWorkspace } from "@/lib/agent-core";
import { errorResponse, json, preflight } from "@/lib/agent-http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ws = await getPublicWorkspace((await params).ws);
    if (!ws) return json({ error: "Unbekannt" }, 404);
    return json(await agentInfo(ws));
  } catch (e) {
    return errorResponse(e);
  }
}

export const OPTIONS = preflight;

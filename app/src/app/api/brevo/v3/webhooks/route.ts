import { db } from "@/lib/db";
import { apiError } from "@/lib/apikey";
import { iso, readJson, withApiKey } from "@/lib/mail-api";
import { webhookCreateSchema } from "@/lib/mail-schema";
import { validateWebhookUrl } from "@/lib/webhook";
import type { Webhook } from "@prisma/client";

export const dynamic = "force-dynamic";

function toBrevo(w: Webhook) {
  return { id: w.numericId, url: w.url, description: w.description ?? "", events: w.events, type: w.type, createdAt: iso(w.createdAt), modifiedAt: iso(w.createdAt) };
}

// GET /v3/webhooks?type=transactional|marketing
export async function GET(req: Request) {
  return withApiKey(req, "webhooks:manage", async (auth) => {
    const type = new URL(req.url).searchParams.get("type") ?? "transactional";
    const rows = await db.webhook.findMany({ where: { workspaceId: auth.workspaceId, type }, orderBy: { createdAt: "desc" } });
    return Response.json({ webhooks: rows.map(toBrevo) });
  });
}

// POST /v3/webhooks → 201 { id }
export async function POST(req: Request) {
  return withApiKey(req, "webhooks:manage", async (auth) => {
    const body = await readJson(req, 50_000);
    if (!body.ok) return body.res;
    const p = webhookCreateSchema.safeParse(body.data);
    if (!p.success) return apiError(400, "invalid_parameter", `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}`);
    const urlProblem = validateWebhookUrl(p.data.url);
    if (urlProblem) return apiError(400, "invalid_parameter", urlProblem);
    if ((await db.webhook.count({ where: { workspaceId: auth.workspaceId } })) >= 40) {
      return apiError(400, "invalid_parameter", "Maximal 40 Webhooks je Sub-Account");
    }
    const w = await db.webhook.create({ data: { workspaceId: auth.workspaceId, ...p.data } });
    return Response.json({ id: w.numericId }, { status: 201 });
  });
}

import { db } from "@/lib/db";
import { apiError } from "@/lib/apikey";
import { iso, readJson, withApiKey } from "@/lib/mail-api";
import { webhookUpdateSchema } from "@/lib/mail-schema";
import { validateWebhookUrl } from "@/lib/webhook";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ webhookId: string }> };

async function own(workspaceId: string, raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  return db.webhook.findFirst({ where: { numericId: id, workspaceId } });
}

export async function GET(req: Request, { params }: Ctx) {
  return withApiKey(req, "webhooks:manage", async (auth) => {
    const w = await own(auth.workspaceId, (await params).webhookId);
    if (!w) return apiError(404, "document_not_found", "Webhook ID does not exist");
    return Response.json({ id: w.numericId, url: w.url, description: w.description ?? "", events: w.events, type: w.type, createdAt: iso(w.createdAt), modifiedAt: iso(w.createdAt) });
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return withApiKey(req, "webhooks:manage", async (auth) => {
    const w = await own(auth.workspaceId, (await params).webhookId);
    if (!w) return apiError(404, "document_not_found", "Webhook ID does not exist");
    const body = await readJson(req, 50_000);
    if (!body.ok) return body.res;
    const p = webhookUpdateSchema.safeParse(body.data);
    if (!p.success) return apiError(400, "invalid_parameter", `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}`);
    if (p.data.url) {
      const problem = validateWebhookUrl(p.data.url);
      if (problem) return apiError(400, "invalid_parameter", problem);
    }
    await db.webhook.update({ where: { id: w.id }, data: p.data });
    return new Response(null, { status: 204 });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withApiKey(req, "webhooks:manage", async (auth) => {
    const w = await own(auth.workspaceId, (await params).webhookId);
    if (!w) return apiError(404, "document_not_found", "Webhook ID does not exist");
    await db.webhook.delete({ where: { id: w.id } });
    return new Response(null, { status: 204 });
  });
}

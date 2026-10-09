import { db } from "@/lib/db";
import { apiError } from "@/lib/apikey";
import { toBrevoTemplate, withApiKey } from "@/lib/mail-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ templateId: string }> }) {
  return withApiKey(req, "templates:read", async (auth) => {
    const id = Number((await params).templateId);
    if (!Number.isInteger(id)) return apiError(400, "invalid_parameter", "templateId must be an integer");
    const t = await db.emailTemplate.findFirst({ where: { numericId: id, workspaceId: auth.workspaceId } });
    if (!t) return apiError(404, "document_not_found", "Template ID does not exist");
    return Response.json(toBrevoTemplate(t));
  });
}

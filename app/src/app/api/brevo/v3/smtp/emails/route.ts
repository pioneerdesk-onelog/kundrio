import { db } from "@/lib/db";
import { apiError } from "@/lib/apikey";
import { intParam, iso, withApiKey } from "@/lib/mail-api";

export const dynamic = "force-dynamic";

// GET /v3/smtp/emails?email|templateId|messageId (mindestens einer, wie bei Brevo)
export async function GET(req: Request) {
  return withApiKey(req, "mail:send", async (auth) => {
    const q = new URL(req.url).searchParams;
    const email = q.get("email")?.toLowerCase();
    const messageId = q.get("messageId");
    const templateNum = q.get("templateId");
    if (!email && !messageId && !templateNum) return apiError(400, "missing_parameter", "email, templateId or messageId is required");
    let templateId: string | undefined;
    if (templateNum) {
      const t = await db.emailTemplate.findFirst({ where: { numericId: Number(templateNum) || -1, workspaceId: auth.workspaceId } });
      templateId = t?.id ?? "__keine__";
    }
    const where = {
      workspaceId: auth.workspaceId,
      kind: "transactional",
      ...(email ? { toAddr: { contains: email } } : {}),
      ...(messageId ? { messageId } : {}),
      ...(templateId ? { templateId } : {}),
    };
    const [count, rows] = await Promise.all([
      db.emailMessage.count({ where }),
      db.emailMessage.findMany({
        where,
        orderBy: { createdAt: q.get("sort") === "asc" ? "asc" : "desc" },
        take: intParam(q.get("limit"), 500, 1, 1000),
        skip: intParam(q.get("offset"), 0, 0, 1_000_000),
        include: { events: { orderBy: { at: "asc" } } },
      }),
    ]);
    return Response.json({
      count,
      transactionalEmails: rows.map((m) => ({
        email: m.toAddr.split(",")[0].trim(),
        subject: m.subject,
        messageId: m.messageId,
        uuid: m.id,
        date: iso(m.createdAt),
        from: m.fromAddr,
        tags: m.tags,
        status: m.status,
      })),
    });
  });
}

import { db } from "@/lib/db";
import { intParam, toBrevoTemplate, withApiKey } from "@/lib/mail-api";

export const dynamic = "force-dynamic";

// GET /v3/smtp/templates?templateStatus=true&limit=50&offset=0&sort=desc
export async function GET(req: Request) {
  return withApiKey(req, "templates:read", async (auth) => {
    const u = new URL(req.url);
    const status = u.searchParams.get("templateStatus");
    const where = { workspaceId: auth.workspaceId, ...(status === "true" ? { isActive: true } : status === "false" ? { isActive: false } : {}) };
    const [count, rows] = await Promise.all([
      db.emailTemplate.count({ where }),
      db.emailTemplate.findMany({
        where,
        orderBy: { createdAt: u.searchParams.get("sort") === "asc" ? "asc" : "desc" },
        take: intParam(u.searchParams.get("limit"), 50, 1, 1000),
        skip: intParam(u.searchParams.get("offset"), 0, 0, 1_000_000),
      }),
    ]);
    return Response.json({ count, templates: rows.map(toBrevoTemplate) });
  });
}

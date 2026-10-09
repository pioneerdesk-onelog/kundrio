import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { intParam, iso, STAT_EVENT, withApiKey } from "@/lib/mail-api";

export const dynamic = "force-dynamic";

// GET /v3/smtp/statistics/events?limit&offset&startDate&endDate&days&email&event&tags&messageId&templateId&sort
export async function GET(req: Request) {
  return withApiKey(req, "mail:send", async (auth) => {
    const q = new URL(req.url).searchParams;
    const at: Prisma.DateTimeFilter = {};
    if (q.get("days")) at.gte = new Date(Date.now() - intParam(q.get("days"), 30, 1, 90) * 86_400_000);
    const start = q.get("startDate");
    const end = q.get("endDate");
    if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) at.gte = new Date(`${start}T00:00:00Z`);
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) at.lte = new Date(`${end}T23:59:59Z`);

    const stat = q.get("event");
    const events = stat ? Object.entries(STAT_EVENT).filter(([, v]) => v === stat).map(([k]) => k) : null;
    if (stat === "bounces") events?.push("hard_bounce", "soft_bounce");

    const message: Prisma.EmailMessageWhereInput = { kind: "transactional" };
    if (q.get("email")) message.toAddr = { contains: q.get("email")!.toLowerCase() };
    if (q.get("messageId")) message.messageId = q.get("messageId")!;
    if (q.get("tags")) message.tags = { hasSome: q.get("tags")!.split(",").slice(0, 10) };
    if (q.get("templateId")) {
      const t = await db.emailTemplate.findFirst({ where: { numericId: Number(q.get("templateId")) || -1, workspaceId: auth.workspaceId } });
      message.templateId = t?.id ?? "__keine__";
    }

    const rows = await db.emailEvent.findMany({
      where: {
        workspaceId: auth.workspaceId,
        ...(Object.keys(at).length ? { at } : {}),
        ...(events ? { event: { in: events } } : {}),
        message,
      },
      include: { message: true },
      orderBy: { at: q.get("sort") === "asc" ? "asc" : "desc" },
      take: intParam(q.get("limit"), 2500, 1, 2500),
      skip: intParam(q.get("offset"), 0, 0, 1_000_000),
    });
    return Response.json({
      events: rows.map((e) => ({
        email: e.message.toAddr.split(",")[0].trim(),
        date: iso(e.at),
        subject: e.message.subject,
        messageId: e.message.messageId,
        event: STAT_EVENT[e.event] ?? e.event,
        reason: e.reason ?? undefined,
        tag: e.message.tags[0] ?? "",
        link: e.link ?? undefined,
        from: e.message.fromAddr,
      })),
    });
  });
}

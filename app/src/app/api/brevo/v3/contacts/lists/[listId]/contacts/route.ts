import { db } from "@/lib/db";
import { contactJson, findList, withApi } from "@/lib/lists-api";
import { parsePaging } from "@/lib/migrate/brevo-map";

// GET /v3/contacts/lists/{listId}/contacts
export async function GET(req: Request, { params }: { params: Promise<{ listId: string }> }) {
  return withApi(req, "contacts:read", async ({ workspaceId }) => {
    const l = await findList(workspaceId, (await params).listId);
    const { limit, offset, sort } = parsePaging(new URL(req.url).searchParams, 50, 500);
    const where = { listId: l.id };
    const [rows, count] = await Promise.all([
      db.contactListMember.findMany({ where, orderBy: { addedAt: sort }, skip: offset, take: limit, include: { contact: true } }),
      db.contactListMember.count({ where }),
    ]);
    return Response.json({ contacts: await Promise.all(rows.map((r) => contactJson(r.contact))), count });
  });
}

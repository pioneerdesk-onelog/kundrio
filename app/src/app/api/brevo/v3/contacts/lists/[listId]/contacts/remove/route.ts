import { db } from "@/lib/db";
import { findList, readJson, withApi } from "@/lib/lists-api";
import { resolveMemberTargets } from "@/lib/lists-members";

export async function POST(req: Request, { params }: { params: Promise<{ listId: string }> }) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const l = await findList(workspaceId, (await params).listId);
    const { found, failure, all } = await resolveMemberTargets(workspaceId, await readJson(req), true);
    if (all) {
      const n = await db.contactListMember.deleteMany({ where: { listId: l.id } });
      return Response.json({ contacts: { success: n.count, failure: [] } }, { status: 201 });
    }
    await db.contactListMember.deleteMany({ where: { listId: l.id, contactId: { in: found.map((c) => c.id) } } });
    return Response.json({ contacts: { success: found.map((c) => c.email ?? c.id), failure } }, { status: 201 });
  });
}

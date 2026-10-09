import { db } from "@/lib/db";
import { findList, readJson, withApi } from "@/lib/lists-api";
import { resolveMemberTargets } from "@/lib/lists-members";

export async function POST(req: Request, { params }: { params: Promise<{ listId: string }> }) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const l = await findList(workspaceId, (await params).listId);
    const { found, failure } = await resolveMemberTargets(workspaceId, await readJson(req), false);
    await db.contactListMember.createMany({ data: found.map((c) => ({ listId: l.id, contactId: c.id })), skipDuplicates: true });
    return Response.json({ contacts: { success: found.map((c) => c.email ?? c.id), failure } }, { status: 201 });
  });
}

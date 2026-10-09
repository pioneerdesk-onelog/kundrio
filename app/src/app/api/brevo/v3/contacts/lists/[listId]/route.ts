import { db } from "@/lib/db";
import { ApiError, findList, listJson, noContent, readJson, withApi } from "@/lib/lists-api";

type Ctx = { params: Promise<{ listId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withApi(req, "contacts:read", async ({ workspaceId }) => {
    const l = await findList(workspaceId, (await params).listId);
    return Response.json(await listJson(l));
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const l = await findList(workspaceId, (await params).listId);
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) throw new ApiError(400, "missing_parameter", "name is missing");
    const dup = await db.contactList.findFirst({ where: { workspaceId, name, NOT: { id: l.id } } });
    if (dup) throw new ApiError(400, "duplicate_parameter", "List name already exists");
    await db.contactList.update({ where: { id: l.id }, data: { name } });
    return noContent();
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const l = await findList(workspaceId, (await params).listId);
    await db.contactList.deleteMany({ where: { id: l.id, workspaceId } });
    return noContent();
  });
}

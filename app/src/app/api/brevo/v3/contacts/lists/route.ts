import { db } from "@/lib/db";
import { ApiError, listJson, readJson, withApi } from "@/lib/lists-api";
import { parsePaging } from "@/lib/migrate/brevo-map";

export async function GET(req: Request) {
  return withApi(req, "contacts:read", async ({ workspaceId }) => {
    const { limit, offset, sort } = parsePaging(new URL(req.url).searchParams, 10, 50);
    const [rows, count] = await Promise.all([
      db.contactList.findMany({ where: { workspaceId }, orderBy: { createdAt: sort }, skip: offset, take: limit }),
      db.contactList.count({ where: { workspaceId } }),
    ]);
    return Response.json({ lists: await Promise.all(rows.map(listJson)), count });
  });
}

export async function POST(req: Request) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) throw new ApiError(400, "missing_parameter", "name is missing");
    const dup = await db.contactList.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
    if (dup) throw new ApiError(400, "duplicate_parameter", "List name already exists");
    const l = await db.contactList.create({ data: { workspaceId, name, source: "api" } });
    return Response.json({ id: l.numericId }, { status: 201 });
  });
}

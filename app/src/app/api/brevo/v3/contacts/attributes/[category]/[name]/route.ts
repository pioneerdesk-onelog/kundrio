import { db } from "@/lib/db";
import { ApiError, noContent, readJson, withApi } from "@/lib/lists-api";
import { normalizeAttrKey, STANDARD_ATTRS } from "@/lib/migrate/brevo-map";
import { fromBrevoType } from "@/lib/properties";

type Ctx = { params: Promise<{ category: string; name: string }> };

async function parse(params: Ctx["params"]) {
  const { category, name } = await params;
  if (category !== "normal" && category !== "category") throw new ApiError(400, "invalid_parameter", "Only normal and category attributes are supported");
  const key = normalizeAttrKey(decodeURIComponent(name));
  if (!key) throw new ApiError(400, "invalid_parameter", "Invalid attribute name");
  if (STANDARD_ATTRS[key]) throw new ApiError(400, "invalid_parameter", "Standard attribute cannot be changed");
  return { category, key };
}

function options(body: Record<string, unknown>) {
  if (!Array.isArray(body.enumeration)) return undefined;
  return body.enumeration
    .map((e) => (e && typeof e === "object" ? String((e as { label?: unknown }).label ?? "") : ""))
    .filter(Boolean)
    .slice(0, 200)
    .map((label) => ({ value: label, label }));
}

// POST /v3/contacts/attributes/{category}/{name}
export async function POST(req: Request, ctx: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const { category, key } = await parse(ctx.params);
    const body = await readJson(req);
    const type = category === "category" ? "select" : fromBrevoType(body.type);
    const exists = await db.propertyDefinition.findUnique({ where: { workspaceId_objectType_key: { workspaceId, objectType: "contact", key } } });
    if (exists) throw new ApiError(400, "duplicate_parameter", "Attribute name must be unique");
    await db.propertyDefinition.create({ data: { workspaceId, objectType: "contact", key, label: key, type, options: options(body), source: "api" } });
    return new Response(null, { status: 201 });
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const { key } = await parse(ctx.params);
    const body = await readJson(req);
    const res = await db.propertyDefinition.updateMany({
      where: { workspaceId, objectType: "contact", key },
      data: { ...(options(body) ? { options: options(body), type: "select" } : {}) },
    });
    if (!res.count) throw new ApiError(404, "document_not_found", "Attribute does not exist");
    return noContent();
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId }) => {
    const { key } = await parse(ctx.params);
    const res = await db.propertyDefinition.deleteMany({ where: { workspaceId, objectType: "contact", key } });
    if (!res.count) throw new ApiError(404, "document_not_found", "Attribute does not exist");
    return noContent();
  });
}

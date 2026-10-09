import { apiError } from "@/lib/apikey";
import { ErasureBlockedError, eraseContact } from "@/lib/privacy/erase";
import { applyContactWrite, contactJson, findContact, noContent, readJson, withApi } from "@/lib/lists-api";

type Ctx = { params: Promise<{ identifier: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withApi(req, "contacts:read", async ({ workspaceId }) => {
    const c = await findContact(workspaceId, (await params).identifier);
    return Response.json(await contactJson(c));
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId, keyName }) => {
    const c = await findContact(workspaceId, (await params).identifier);
    const body = await readJson(req);
    // E-Mail-Wechsel über attributes.EMAIL wird bewusst nicht unterstützt (Einwilligung hängt an der Adresse)
    await applyContactWrite(workspaceId, c.id, c.email ?? "", body, keyName);
    return noContent();
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withApi(req, "contacts:write", async ({ workspaceId, keyId }) => {
    const c = await findContact(workspaceId, (await params).identifier);
    try {
      await eraseContact(workspaceId, c.id, `apikey:${keyId}`);
    } catch (e) {
      if (e instanceof ErasureBlockedError) return apiError(409, "method_not_allowed", e.message);
      throw e;
    }
    return noContent();
  });
}

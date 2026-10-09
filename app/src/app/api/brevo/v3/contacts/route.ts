import { db } from "@/lib/db";
import { ApiError, applyContactWrite, contactJson, readJson, withApi } from "@/lib/lists-api";
import { normalizeEmail, parsePaging } from "@/lib/migrate/brevo-map";

// Brevo-kompatibel: GET /v3/contacts (Liste), POST /v3/contacts (anlegen bzw. Upsert mit updateEnabled)

export async function GET(req: Request) {
  return withApi(req, "contacts:read", async ({ workspaceId }) => {
    const sp = new URL(req.url).searchParams;
    const { limit, offset, sort } = parsePaging(sp, 50, 1000);
    const since = sp.get("modifiedSince");
    const sinceDate = since ? new Date(since) : null;
    if (since && Number.isNaN(sinceDate!.getTime())) throw new ApiError(400, "invalid_parameter", "modifiedSince must be a date");
    const where = { workspaceId, email: { not: null }, ...(sinceDate ? { updatedAt: { gte: sinceDate } } : {}) };
    const [rows, count] = await Promise.all([
      db.contact.findMany({ where, orderBy: { createdAt: sort }, skip: offset, take: limit }),
      db.contact.count({ where }),
    ]);
    return Response.json({ contacts: await Promise.all(rows.map(contactJson)), count });
  });
}

export async function POST(req: Request) {
  return withApi(req, "contacts:write", async ({ workspaceId, keyName }) => {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!email) throw new ApiError(400, "invalid_parameter", "Invalid email address");
    const existing = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
    if (existing && body.updateEnabled !== true) throw new ApiError(400, "duplicate_parameter", "Contact already exist");
    const { contact, created } = await applyContactWrite(workspaceId, existing?.id ?? null, email, body, keyName);
    // Brevo: 201 mit ID bei Neuanlage, 204 bei Aktualisierung
    return created ? Response.json({ id: contact.id }, { status: 201 }) : new Response(null, { status: 204 });
  });
}

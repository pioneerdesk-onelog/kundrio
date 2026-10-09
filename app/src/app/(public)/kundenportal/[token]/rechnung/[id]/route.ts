import { db } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { rateLimitAsync } from "@/lib/ratelimit";
import { documentPdf } from "@/lib/documents/send";
import { contactForPortalToken } from "@/lib/billing/portal";

// Rechnungs-PDF für den Kunden (nur eigene, versendete Rechnungen).
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  if (!(await rateLimitAsync(`portal-pdf:${clientIp(req.headers)}`, 60, 10 * 60_000))) return new Response("Zu viele Anfragen", { status: 429 });
  const contact = await contactForPortalToken(token);
  if (!contact) return new Response("Nicht gefunden", { status: 404 });
  const inv = await db.invoice.findFirst({ where: { id, workspaceId: contact.workspaceId, contactId: contact.id, kind: "INVOICE", status: { in: ["SENT", "PAID"] } }, select: { id: true } });
  if (!inv) return new Response("Nicht gefunden", { status: 404 });
  const pdf = await documentPdf(contact.workspaceId, inv.id, "customer");
  return new Response(Buffer.from(pdf.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdf.filename}"`, "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

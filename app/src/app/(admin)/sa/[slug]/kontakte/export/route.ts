import { db } from "@/lib/db";
import { routeGuard, withScope } from "@/lib/permissions/guard";
import { toCsv } from "@/lib/a-csv";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Export ist ein eigenes Recht (Schutz vor Datenabfluss) und bleibt in der Lese-Reichweite
  const g = await routeGuard(slug, { special: "export" });
  if (g instanceof Response) return g;
  const { ws, access } = g;
  const contacts = await db.contact.findMany({ where: withScope({ workspaceId: ws.id }, access, "contacts"), orderBy: { createdAt: "asc" } });
  const csv = toCsv([
    ["firstName", "lastName", "email", "phone", "company", "tags", "source", "consentEmailAt", "unsubscribedAt", "createdAt"],
    ...contacts.map((c) => [
      c.firstName, c.lastName, c.email, c.phone, c.company, c.tags.join("|"), c.source,
      c.consentEmailAt?.toISOString(), c.unsubscribedAt?.toISOString(), c.createdAt.toISOString(),
    ]),
  ]);
  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kontakte-${ws.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}

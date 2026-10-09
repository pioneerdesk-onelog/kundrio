import { NextResponse } from "next/server";
import { routeGuard } from "@/lib/permissions/guard";
import { exportCsv } from "@/lib/migrate/export";
import { exportHubspotObjects } from "@/lib/migrate/hubspot-export";

const FORMATS = ["brevo", "hubspot", "sperrliste", "hubspot-companies", "hubspot-deals", "hubspot-tickets"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; format: string }> }) {
  const { slug, format } = await params;
  // Wechsel-Exporte enthalten den gesamten Bestand → Recht „Daten exportieren“ und volle Lese-Reichweite
  const g = await routeGuard(slug, { special: "export" });
  if (g instanceof Response) return g;
  const { ws, access } = g;
  const full = (o: "contacts" | "companies" | "deals" | "tickets") => access.perms.objects[o].read === "all";
  const needed = format === "hubspot-companies" ? "companies" : format === "hubspot-deals" ? "deals" : format === "hubspot-tickets" ? "tickets" : "contacts";
  if (!full(needed)) return new NextResponse("Für diesen Export ist die Lese-Reichweite „alle“ nötig.", { status: 403 });
  if (!(FORMATS as readonly string[]).includes(format)) return new NextResponse("Unbekanntes Format", { status: 404 });
  const csv =
    format === "hubspot-companies" || format === "hubspot-deals" || format === "hubspot-tickets"
      ? await exportHubspotObjects(ws.id, format.slice("hubspot-".length) as "companies" | "deals" | "tickets")
      : await exportCsv(ws.id, format as "brevo" | "hubspot" | "sperrliste");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ws.slug}-${format}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}

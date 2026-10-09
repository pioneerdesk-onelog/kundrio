import { z } from "zod";
import { db } from "@/lib/db";
import { routeGuard } from "@/lib/permissions/guard";
import { IMPORT_MAX_BYTES, parseExport, toMetricRows, toPostRows } from "@/lib/channels/import";
import { applyImport } from "@/lib/channels/sync";

// Import eines Plattform-Exports (CSV). Schritt 1: Vorschau (Kopf, Zuordnungsvorschlag, Beispielzeilen),
// Schritt 2: mit bestätigter Zuordnung speichern. Route-Handler statt Server Action wegen Dateigröße (bis 2 MB).

const Body = z.object({
  slug: z.string().min(1).max(100),
  accountId: z.string().min(1).max(60),
  text: z.string().min(1),
  apply: z.boolean().optional(),
  kind: z.enum(["metrics", "posts"]).optional(),
  mapping: z.array(z.string().max(40)).max(200).optional(),
});

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > IMPORT_MAX_BYTES * 1.2) return Response.json({ error: "Datei ist größer als 2 MB." }, { status: 413 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  const b = parsed.data;

  const g = await routeGuard(b.slug, { object: "analytics", action: "edit" });
  if (g instanceof Response) return g;
  const acc = await db.channelAccount.findFirst({ where: { id: b.accountId, workspaceId: g.ws.id } });
  if (!acc) return Response.json({ error: "Kanal nicht gefunden." }, { status: 404 });

  try {
    const exp = parseExport(b.text);
    const kind = b.kind ?? exp.kind;
    if (!b.apply) {
      return Response.json({ header: exp.header, kind, mapping: kind === exp.kind ? exp.mapping : exp.header.map(() => "skip"), sample: exp.rows.slice(0, 5), rows: exp.rows.length });
    }
    const mapping = b.mapping ?? exp.mapping;
    if (mapping.length !== exp.header.length) return Response.json({ error: "Zuordnung passt nicht zur Datei." }, { status: 400 });
    const n =
      kind === "metrics"
        ? await applyImport(acc.id, g.ws.id, { metrics: toMetricRows(exp.rows, mapping) })
        : await applyImport(acc.id, g.ws.id, { posts: toPostRows(exp.rows, mapping) });
    return Response.json({ ok: `${n} ${kind === "metrics" ? "Tageswerte" : "Beiträge"} importiert.` });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { db } from "@/lib/db";
import { canAccessWorkspace, getCurrentUser } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { can, getAccess } from "@/lib/permissions";
import { IMPORT_CHUNK_BYTES, IMPORT_MAX_BYTES, importLogText, splitChunks } from "@/lib/analytics/importlog";

// Upload eines Access-Logs (nur angemeldet, nur eigene Sub-Accounts, nur von der App selbst).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });

  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: "Fremde Herkunft." }, { status: 403 });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > IMPORT_MAX_BYTES + 64 * 1024) return Response.json({ error: "Datei zu groß (max. 20 MB)." }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  const slug = String(form.get("ws") ?? "");
  const file = form.get("file");
  const ws = await db.workspace.findUnique({ where: { slug }, select: { id: true, domain: true } });
  if (!ws || !canAccessWorkspace(user, ws.id)) return Response.json({ error: "Sub-Account nicht gefunden." }, { status: 404 });
  // Log-Import schreibt Analytics-Daten → Bearbeitungsrecht nötig
  const access = await getAccess(user.id, ws.id);
  if (!access || !can(access, "analytics", "edit")) return Response.json({ error: "Keine Berechtigung für den Log-Import." }, { status: 403 });
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Bitte eine Log-Datei auswählen." }, { status: 400 });
  if (file.size > IMPORT_MAX_BYTES) return Response.json({ error: "Datei zu groß (max. 20 MB)." }, { status: 413 });

  const text = await file.text();
  if (Buffer.byteLength(text) <= IMPORT_CHUNK_BYTES) {
    const result = await importLogText(ws.id, text, ws.domain);
    return Response.json({ mode: "direkt", ...result });
  }
  const chunks = splitChunks(text);
  for (const c of chunks) await enqueue("analytics.import", { workspaceId: ws.id, text: c, ownHost: ws.domain });
  return Response.json({ mode: "hintergrund", queued: chunks.length });
}

import { NextResponse } from "next/server";
import { routeGuard } from "@/lib/permissions/guard";
import { storeFile, MAX_FILE_BYTES } from "@/lib/storage";
import { audit } from "@/lib/audit";

// Upload von Brandbook-/CI-Dateien (multipart). Nur mit „Einstellungen verwalten“.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await routeGuard(slug, { special: "manage_settings" });
  if (ctx instanceof Response) return ctx;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FILE_BYTES * 5 + 1024 * 1024) return NextResponse.json({ error: "Upload zu groß (max. 5 Dateien à 25 MB)." }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload konnte nicht gelesen werden." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f).slice(0, 5);
  if (!files.length) return NextResponse.json({ error: "Keine Datei ausgewählt." }, { status: 400 });

  const results: { name: string; ok: boolean; id?: string; duplicate?: boolean; error?: string }[] = [];
  for (const f of files) {
    try {
      if (f.size > MAX_FILE_BYTES) throw new Error(`„${f.name}“ ist größer als 25 MB.`);
      const data = new Uint8Array(await f.arrayBuffer());
      const kind = /\.(svg|png|jpe?g)$/i.test(f.name) && /logo|signet|wortmarke/i.test(f.name) ? "logo" : "brandbook";
      const { file, duplicate } = await storeFile({ workspaceId: ctx.ws.id, kind, name: f.name, data, createdBy: ctx.user.id });
      results.push({ name: file.name, ok: true, id: file.id, duplicate });
      if (!duplicate) await audit({ workspaceId: ctx.ws.id, actor: `user:${ctx.user.id}`, action: "file.uploaded", target: file.id, detail: { kind, size: file.size, mime: file.mime } });
    } catch (e) {
      results.push({ name: f.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ results }, { status: results.some((r) => r.ok) ? 200 : 400 });
}

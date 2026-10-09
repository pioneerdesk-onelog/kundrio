"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { guard } from "@/lib/permissions/guard";
import { CATALOG } from "@/lib/compliance-catalog";
import { runAutoChecks } from "@/lib/compliance-checks";
import { scheduleAutocheck } from "@/lib/compliance-schedule";

export type ItemState = { ok?: string; error?: string };

export async function adoptCatalog(slug: string) {
  const { ws } = await guard(slug, { object: "compliance", action: "edit" });
  for (const c of CATALOG) {
    await db.complianceItem.upsert({
      where: { workspaceId_framework_key: { workspaceId: ws.id, framework: c.framework, key: c.key } },
      // Bestehende Status/Nachweise bleiben erhalten; nur Texte aktualisieren
      update: { title: c.title, description: c.description },
      create: { workspaceId: ws.id, framework: c.framework, key: c.key, title: c.title, description: c.description },
    });
  }
  // Erste automatische Prüfung gleich einplanen, danach wöchentlich
  await scheduleAutocheck(ws.id, new Date());
  revalidatePath(`/sa/${slug}/pflichten`);
}

export async function runChecks(slug: string, _prev: ItemState): Promise<ItemState> {
  const { ws } = await guard(slug, { object: "compliance", action: "edit" });
  try {
    const r = await runAutoChecks(ws.id);
    revalidatePath(`/sa/${slug}/pflichten`);
    return { ok: `${Object.keys(r).length} automatische Prüfungen ausgeführt.` };
  } catch (e) {
    return { error: `Prüfung fehlgeschlagen: ${(e as Error).message}` };
  }
}

const itemSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "N_A"]),
  evidence: z.string().trim().max(2000),
  dueAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als JJJJ-MM-TT")]),
});

export async function saveItem(slug: string, id: string, _prev: ItemState, formData: FormData): Promise<ItemState> {
  const { ws } = await guard(slug, { object: "compliance", action: "edit" });
  const parsed = itemSchema.safeParse({
    status: formData.get("status"),
    evidence: String(formData.get("evidence") ?? ""),
    dueAt: String(formData.get("dueAt") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const res = await db.complianceItem.updateMany({
    where: { id, workspaceId: ws.id },
    data: { status: d.status, evidence: d.evidence || null, dueAt: d.dueAt ? new Date(`${d.dueAt}T12:00:00Z`) : null },
  });
  if (res.count === 0) return { error: "Pflichtpunkt nicht gefunden." };
  revalidatePath(`/sa/${slug}/pflichten`);
  return { ok: "Gespeichert." };
}

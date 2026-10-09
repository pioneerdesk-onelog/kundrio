import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { sanitizeSvg } from "../svg-sanitize";
import { brandGuideSchema, matchAppFont, parseGuide, SUGGESTION_FIELDS, type BrandGuide, type SuggestionField } from "./guide";

// Vorschläge für Marke & CI (EnrichmentSuggestion mit objectType "workspace").
// Werte aus Brandbook/Website werden vorgeschlagen; ein Mensch mit „Einstellungen verwalten“ übernimmt.

import type { BrandSourceKind, NewSuggestion } from "./derive";
export type { BrandSourceKind, NewSuggestion } from "./derive";

export async function proposeBrand(workspaceId: string, items: NewSuggestion[]) {
  let created = 0;
  for (const it of items) {
    // ältere offene Vorschläge desselben Felds aus derselben Quellart werden ersetzt
    await db.enrichmentSuggestion.updateMany({
      where: { workspaceId, objectType: "workspace", objectId: workspaceId, field: it.field, status: "proposed", sourceKind: it.sourceKind },
      data: { status: "superseded" },
    });
    await db.enrichmentSuggestion.create({
      data: {
        workspaceId,
        objectType: "workspace",
        objectId: workspaceId,
        field: it.field,
        value: it.value as Prisma.InputJsonValue,
        sourceUrl: it.sourceUrl ?? null,
        sourceKind: it.sourceKind,
        confidence: it.confidence ?? null,
      },
    });
    created++;
  }
  return created;
}

export async function openBrandSuggestions(workspaceId: string) {
  return db.enrichmentSuggestion.findMany({
    where: { workspaceId, objectType: "workspace", objectId: workspaceId, status: "proposed" },
    orderBy: [{ field: "asc" }, { createdAt: "desc" }],
  });
}

const GUIDE_KEY: Partial<Record<SuggestionField, keyof BrandGuide>> = {
  "guide.colors": "colors",
  "guide.voice": "voice",
  "guide.doAndDont": "doAndDont",
  "guide.audience": "audience",
  "guide.writingRules": "writingRules",
  "guide.typography": "typography",
  "guide.logoRules": "logoRules",
  "guide.spotColors": "spotColors",
};

/** Übernimmt einen Vorschlag in Workspace/Leitfaden. Prüft den Wert erneut (keine ungeprüften Daten). */
export async function acceptBrandSuggestion(workspaceId: string, id: string, actor: { userId: string }) {
  const s = await db.enrichmentSuggestion.findFirst({ where: { id, workspaceId, objectType: "workspace", objectId: workspaceId, status: "proposed" } });
  if (!s) throw new Error("Vorschlag nicht gefunden oder bereits entschieden");
  const field = s.field as SuggestionField;
  if (!(field in SUGGESTION_FIELDS)) throw new Error("Unbekanntes Feld");
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const guide: BrandGuide = parseGuide(ws.brandGuide);
  const v = s.value as Record<string, unknown>;
  const data: Prisma.WorkspaceUpdateInput = {};
  let note: string | undefined;

  if (field === "brandPrimary" || field === "brandAccent") {
    const hex = String(v.hex ?? "");
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Ungültige Farbe");
    data[field] = hex.toUpperCase();
  } else if (field === "fontHeading" || field === "fontBody") {
    const font = String(v.font ?? "");
    const app = matchAppFont(font);
    if (app) data[field] = app;
    // Immer im Leitfaden festhalten; nicht verfügbare Schriften nur dort (lokale Einbindung nötig)
    guide.typography = { others: [], googleFonts: [], ...guide.typography, [field === "fontHeading" ? "heading" : "body"]: font.slice(0, 80) };
    if (!app) note = `Schrift „${font}“ ist in der App nicht lokal eingebunden – nur im Leitfaden vermerkt.`;
  } else if (field === "logoSvg") {
    data.logoSvg = sanitizeSvg(String(v.svg ?? ""));
  } else if (field === "logoFile") {
    const file = await db.storedFile.findFirst({ where: { id: String(v.fileId ?? ""), workspaceId } });
    if (!file) throw new Error("Logo-Datei existiert nicht mehr");
    guide.logoFileId = file.id;
  } else {
    const key = GUIDE_KEY[field]!;
    const parsed = brandGuideSchema.shape[key].safeParse(v.data);
    if (!parsed.success) throw new Error(`Vorschlag „${SUGGESTION_FIELDS[field]}“ hat ein ungültiges Format`);
    (guide as Record<string, unknown>)[key] = parsed.data;
  }

  const kind = (["brandbook", "website", "manual"].includes(s.sourceKind) ? s.sourceKind : "manual") as BrandSourceKind;
  guide.sources = [...(guide.sources ?? []).slice(-45), { kind, ref: (s.sourceUrl ?? SUGGESTION_FIELDS[field]).slice(0, 300), at: new Date().toISOString() }];
  data.brandGuide = brandGuideSchema.parse(guide) as Prisma.InputJsonValue;

  await db.$transaction([
    db.workspace.update({ where: { id: workspaceId }, data }),
    db.enrichmentSuggestion.update({ where: { id: s.id }, data: { status: "accepted", decidedBy: `user:${actor.userId}`, decidedAt: new Date() } }),
  ]);
  await audit({ workspaceId, actor: `user:${actor.userId}`, action: "brand.suggestion_accepted", target: field, detail: { sourceKind: s.sourceKind } });
  return { field, note };
}

export async function rejectBrandSuggestion(workspaceId: string, id: string, actor: { userId: string }) {
  const r = await db.enrichmentSuggestion.updateMany({
    where: { id, workspaceId, objectType: "workspace", objectId: workspaceId, status: "proposed" },
    data: { status: "rejected", decidedBy: `user:${actor.userId}`, decidedAt: new Date() },
  });
  if (!r.count) throw new Error("Vorschlag nicht gefunden oder bereits entschieden");
  await audit({ workspaceId, actor: `user:${actor.userId}`, action: "brand.suggestion_rejected", target: id });
}

// ---------- Status der Auswertung (für die Oberfläche) ----------

export type BrandJobStatus = { state: "queued" | "running" | "done" | "failed"; mode: "files" | "website"; at: string; message?: string; created?: number };

const statusKey = (workspaceId: string) => `brand:status:${workspaceId}`;

export async function setBrandStatus(workspaceId: string, s: BrandJobStatus) {
  await db.appSetting.upsert({
    where: { key: statusKey(workspaceId) },
    create: { key: statusKey(workspaceId), value: s as unknown as Prisma.InputJsonValue },
    update: { value: s as unknown as Prisma.InputJsonValue },
  });
}

export async function getBrandStatus(workspaceId: string): Promise<BrandJobStatus | null> {
  const s = await db.appSetting.findUnique({ where: { key: statusKey(workspaceId) } });
  return (s?.value as BrandJobStatus | undefined) ?? null;
}

"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/permissions";
import { deleteStoredFile } from "@/lib/storage";
import { acceptBrandSuggestion, rejectBrandSuggestion, openBrandSuggestions, setBrandStatus } from "@/lib/brand/suggestions";
import { brandGuideSchema, COLOR_ROLES, parseGuide, type BrandGuide } from "@/lib/brand/guide";

// Marke & CI: Auswertungen starten, Vorschläge übernehmen, Leitfaden manuell pflegen.
// Alles nur mit „Einstellungen verwalten“.

export type BrandState = { ok?: string; error?: string };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function admin(slug: string) {
  return requireAccess(slug, { special: "manage_settings" });
}
const done = (slug: string) => revalidatePath(`/sa/${slug}/einstellungen`);

export async function startBrandbookExtraction(slug: string, fileIds: string[]): Promise<BrandState> {
  try {
    const { ws, user } = await admin(slug);
    const ids = z.array(z.string().max(40)).min(1, "Bitte mindestens eine Datei auswählen").max(10).parse(fileIds);
    const owned = await db.storedFile.count({ where: { workspaceId: ws.id, id: { in: ids } } });
    if (owned !== ids.length) return { error: "Datei nicht gefunden" };
    await setBrandStatus(ws.id, { state: "queued", mode: "files", at: new Date().toISOString() });
    await enqueue("brand.extract", { workspaceId: ws.id, mode: "files", fileIds: ids, requestedBy: user.id });
    done(slug);
    return { ok: "Auswertung gestartet. Vorschläge erscheinen unten, sobald sie fertig ist." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function startWebsiteExtraction(slug: string, _prev: BrandState, fd: FormData): Promise<BrandState> {
  try {
    const { ws, user } = await admin(slug);
    const raw = String(fd.get("domain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const domain = z.string().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Bitte eine Domain wie beispiel.de angeben").max(253).parse(raw);
    await setBrandStatus(ws.id, { state: "queued", mode: "website", at: new Date().toISOString() });
    await enqueue("brand.extract", { workspaceId: ws.id, mode: "website", domain, requestedBy: user.id });
    done(slug);
    return { ok: `Website ${domain} wird ausgewertet …` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? e.issues[0].message : msg(e) };
  }
}

export async function deleteBrandFile(slug: string, fileId: string) {
  const { ws, user } = await admin(slug);
  if (await deleteStoredFile(ws.id, fileId)) await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "file.deleted", target: fileId });
  done(slug);
}

export async function acceptSuggestion(slug: string, id: string) {
  const { ws, user } = await admin(slug);
  await acceptBrandSuggestion(ws.id, id, { userId: user.id });
  done(slug);
}

export async function rejectSuggestion(slug: string, id: string) {
  const { ws, user } = await admin(slug);
  await rejectBrandSuggestion(ws.id, id, { userId: user.id });
  done(slug);
}

/** Alle offenen Vorschläge übernehmen – je Feld nur den neuesten; fehlerhafte werden übersprungen. */
export async function acceptAllSuggestions(slug: string) {
  const { ws, user } = await admin(slug);
  const seen = new Set<string>();
  for (const s of await openBrandSuggestions(ws.id)) {
    if (seen.has(s.field)) {
      await rejectBrandSuggestion(ws.id, s.id, { userId: user.id }).catch(() => {});
      continue;
    }
    seen.add(s.field);
    await acceptBrandSuggestion(ws.id, s.id, { userId: user.id }).catch(() => {});
  }
  done(slug);
}

const lines = (v: FormDataEntryValue | null, max: number) =>
  String(v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

/** Manuelle Pflege: direkt übernommen (der Mensch ist hier selbst die Quelle). */
export async function saveBrandManual(slug: string, _prev: BrandState, fd: FormData): Promise<BrandState> {
  try {
    const { ws, user } = await admin(slug);
    const guide: BrandGuide = parseGuide((await db.workspace.findUniqueOrThrow({ where: { id: ws.id } })).brandGuide);
    const names = fd.getAll("colorName").map(String);
    const hexes = fd.getAll("colorHex").map(String);
    const roles = fd.getAll("colorRole").map(String);
    const colors = hexes
      .map((hex, i) => ({ name: (names[i] ?? "").trim().slice(0, 60), hex: hex.trim().toLowerCase(), role: (COLOR_ROLES as readonly string[]).includes(roles[i]) ? roles[i] : "other", source: "manuell" }))
      .filter((c) => /^#[0-9a-f]{6}$/.test(c.hex));
    const address = String(fd.get("address") ?? "unklar");
    const next: BrandGuide = {
      ...guide,
      colors: colors as BrandGuide["colors"],
      typography: {
        ...(guide.typography ?? { others: [], googleFonts: [] }),
        heading: String(fd.get("typoHeading") ?? "").trim().slice(0, 80) || undefined,
        body: String(fd.get("typoBody") ?? "").trim().slice(0, 80) || undefined,
        others: guide.typography?.others ?? [],
        googleFonts: guide.typography?.googleFonts ?? [],
      },
      voice: String(fd.get("voice") ?? "").trim()
        ? { summary: String(fd.get("voice")).trim().slice(0, 1200), adjectives: lines(fd.get("adjectives"), 10).map((a) => a.slice(0, 40)), sources: ["manuell"] }
        : undefined,
      doAndDont: {
        do: lines(fd.get("do"), 20).map((text) => ({ text: text.slice(0, 400), source: "manuell" })),
        dont: lines(fd.get("dont"), 20).map((text) => ({ text: text.slice(0, 400), source: "manuell" })),
      },
      writingRules: {
        address: (["du", "sie", "unklar"].includes(address) ? address : "unklar") as "du" | "sie" | "unklar",
        gender: String(fd.get("gender") ?? "").trim().slice(0, 200) || undefined,
        terms: lines(fd.get("terms"), 30).map((t) => t.slice(0, 80)),
        notes: guide.writingRules?.notes ?? [],
      },
      logoRules: lines(fd.get("logoRules"), 15).map((text) => ({ text: text.slice(0, 400), source: "manuell" })),
      sources: [...(guide.sources ?? []).slice(-45), { kind: "manual", ref: `bearbeitet von ${user.name}`.slice(0, 300), at: new Date().toISOString() }],
    };
    const parsed = brandGuideSchema.safeParse(next);
    if (!parsed.success) return { error: `Bitte Eingaben prüfen: ${parsed.error.issues[0].path.join(".")} – ${parsed.error.issues[0].message}` };
    await db.workspace.update({ where: { id: ws.id }, data: { brandGuide: parsed.data as Prisma.InputJsonValue } });
    await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "brand.guide_saved", detail: { colors: colors.length } });
    done(slug);
    return { ok: "Markenleitfaden gespeichert." };
  } catch (e) {
    return { error: msg(e) };
  }
}

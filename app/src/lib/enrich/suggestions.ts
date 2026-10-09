import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvent } from "../events";
import { audit } from "../audit";

// Vorschläge aus öffentlichen Quellen: anlegen (ältere gleiche ersetzen), übernehmen, verwerfen.
// Übernehmen schreibt das Feld, `enrichedAt`, eine Aktivität und (bei Kontakten) ein Outbox-Ereignis.

export type ObjectKind = "company" | "contact";
export type SuggestionInput = { field: string; value: unknown; sourceUrl?: string | null; sourceKind: "website" | "impressum" | "searxng" | "ai"; confidence?: number };

/** Felder, die per Anreicherung gesetzt werden dürfen, mit Anzeigename. */
export const FIELD_LABELS: Record<ObjectKind, Record<string, string>> = {
  company: {
    name: "Firmierung",
    address: "Anschrift",
    phone: "Telefon",
    email: "E-Mail (allgemein)",
    website: "Website",
    domain: "Domain",
    registerCourt: "Registergericht",
    registerNumber: "Registernummer",
    vatId: "USt-IdNr.",
    managingDirectors: "Geschäftsführung/Vorstand",
    industry: "Branche",
    size: "Größe (Hinweis)",
    profile: "KI-Profil",
  },
  contact: {
    jobTitle: "Funktion",
  },
};

export function fieldLabel(kind: ObjectKind, field: string): string {
  if (field.startsWith("socialLinks.")) return `Profil: ${field.slice("socialLinks.".length)}`;
  return FIELD_LABELS[kind][field] ?? field;
}

export function isAllowedField(kind: ObjectKind, field: string): boolean {
  if (field.startsWith("socialLinks.")) return /^socialLinks\.[a-z]{1,20}$/.test(field) && (kind === "company" || /^socialLinks\.(linkedin|xing)$/.test(field));
  return field in FIELD_LABELS[kind];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function currentValues(kind: ObjectKind, id: string): Promise<Record<string, unknown> | null> {
  if (kind === "company") {
    const c = await db.company.findUnique({ where: { id } });
    if (!c) return null;
    const attrs = (c.attributes ?? {}) as Record<string, unknown>;
    const social = (c.socialLinks ?? {}) as Record<string, unknown>;
    return {
      name: c.name, address: c.address, phone: c.phone, email: attrs.EMAIL ?? null, website: c.website, domain: c.domain,
      registerCourt: c.registerCourt, registerNumber: c.registerNumber, vatId: c.vatId,
      managingDirectors: c.managingDirectors.length ? c.managingDirectors : null, industry: c.industry, size: c.size, profile: c.profile,
      ...Object.fromEntries(Object.entries(social).map(([k, v]) => [`socialLinks.${k}`, v])),
    };
  }
  const c = await db.contact.findUnique({ where: { id } });
  if (!c) return null;
  const social = (c.socialLinks ?? {}) as Record<string, unknown>;
  return { jobTitle: c.jobTitle, ...Object.fromEntries(Object.entries(social).map(([k, v]) => [`socialLinks.${k}`, v])) };
}

/** Neue Vorschläge speichern. Unverändertes oder schon Übernommenes wird übersprungen; ältere offene Vorschläge desselben Felds werden ersetzt. */
export async function writeSuggestions(workspaceId: string, kind: ObjectKind, objectId: string, items: SuggestionInput[]) {
  const current = (await currentValues(kind, objectId)) ?? {};
  let created = 0;
  for (const it of items) {
    if (!isAllowedField(kind, it.field)) continue;
    if (it.value === undefined || it.value === null || it.value === "" || (Array.isArray(it.value) && it.value.length === 0)) continue;
    if (same(current[it.field], it.value)) continue;
    const open = await db.enrichmentSuggestion.findMany({ where: { workspaceId, objectType: kind, objectId, field: it.field, status: "proposed" } });
    if (open.some((o) => same(o.value, it.value))) continue;
    // Bereits einmal verworfener identischer Vorschlag wird nicht erneut vorgelegt
    const rejected = await db.enrichmentSuggestion.findFirst({ where: { workspaceId, objectType: kind, objectId, field: it.field, status: "rejected", value: { equals: it.value as Prisma.InputJsonValue } } });
    if (rejected) continue;
    await db.$transaction([
      db.enrichmentSuggestion.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "superseded" } }),
      db.enrichmentSuggestion.create({
        data: {
          workspaceId, objectType: kind, objectId, field: it.field, value: it.value as Prisma.InputJsonValue,
          sourceUrl: it.sourceUrl ?? null, sourceKind: it.sourceKind, confidence: it.confidence ?? null,
        },
      }),
    ]);
    created++;
  }
  return { created };
}

/** Vorschlag übernehmen (Rechte prüft der Aufrufer). */
export async function acceptSuggestion(suggestionId: string, workspaceId: string, actor: { userId: string; name: string }) {
  const s = await db.enrichmentSuggestion.findFirst({ where: { id: suggestionId, workspaceId, status: "proposed" } });
  if (!s) throw new Error("Vorschlag ist nicht mehr offen.");
  const kind = s.objectType as ObjectKind;
  if (!isAllowedField(kind, s.field)) throw new Error("Feld kann nicht übernommen werden.");
  const before = (await currentValues(kind, s.objectId)) ?? {};
  const value = s.value as unknown;
  await db.$transaction(async (tx) => {
    if (kind === "company") {
      const c = await tx.company.findFirstOrThrow({ where: { id: s.objectId, workspaceId } });
      const data: Prisma.CompanyUpdateInput = { enrichedAt: new Date() };
      if (s.field.startsWith("socialLinks.")) data.socialLinks = { ...((c.socialLinks ?? {}) as object), [s.field.slice(12)]: value } as Prisma.InputJsonValue;
      else if (s.field === "email") data.attributes = { ...((c.attributes ?? {}) as object), EMAIL: value } as Prisma.InputJsonValue;
      else if (s.field === "managingDirectors") data.managingDirectors = (value as string[]).slice(0, 10);
      else if (s.field === "profile") data.profile = value as Prisma.InputJsonValue;
      else if (s.field === "domain") {
        data.domain = String(value);
        if (!c.website) data.website = `https://${String(value)}`;
      } else (data as Record<string, unknown>)[s.field] = String(value).slice(0, 500);
      await tx.company.update({ where: { id: c.id }, data });
      await tx.activity.create({
        data: { workspaceId, type: "SYSTEM", body: `Unternehmen „${c.name}“: ${fieldLabel(kind, s.field)} aus öffentlicher Quelle übernommen`, meta: { companyId: c.id, field: s.field, source: s.sourceUrl, by: actor.userId } },
      });
    } else {
      const c = await tx.contact.findFirstOrThrow({ where: { id: s.objectId, workspaceId } });
      const data: Prisma.ContactUpdateInput = { enrichedAt: new Date() };
      if (s.field.startsWith("socialLinks.")) data.socialLinks = { ...((c.socialLinks ?? {}) as object), [s.field.slice(12)]: value } as Prisma.InputJsonValue;
      else (data as Record<string, unknown>)[s.field] = String(value).slice(0, 200);
      await tx.contact.update({ where: { id: c.id }, data });
      await tx.activity.create({
        data: { workspaceId, contactId: c.id, type: "SYSTEM", body: `${fieldLabel(kind, s.field)} aus öffentlicher Quelle übernommen`, meta: { field: s.field, source: s.sourceUrl, by: actor.userId } },
      });
      await emitEvent(
        { workspaceId, type: "contact.property_changed", objectType: "contact", objectId: c.id, data: { field: s.field, from: before[s.field] ?? null, to: value, source: "enrichment" } },
        tx,
      );
    }
    await tx.enrichmentSuggestion.update({ where: { id: s.id }, data: { status: "accepted", decidedBy: actor.name, decidedAt: new Date() } });
  });
  await audit({ workspaceId, actor: `user:${actor.userId}`, action: "enrichment.accepted", target: `${kind}:${s.objectId}`, detail: { field: s.field } });
  return s;
}

export async function rejectSuggestion(suggestionId: string, workspaceId: string, actor: { userId: string; name: string }) {
  const r = await db.enrichmentSuggestion.updateMany({ where: { id: suggestionId, workspaceId, status: "proposed" }, data: { status: "rejected", decidedBy: actor.name, decidedAt: new Date() } });
  if (r.count === 0) throw new Error("Vorschlag ist nicht mehr offen.");
}

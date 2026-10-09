import "server-only";
import { emitEvent } from "@/lib/events";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { normalizeEmail } from "./brevo-map";
import type { ImportRecord } from "./csv";
import { ensureProperties } from "../properties";

export type CsvImportResult = { created: number; updated: number; skipped: number; suppressed: number; listsCreated: number };

/**
 * Datensätze aus Brevo-/HubSpot-/eigener CSV übernehmen.
 * Einwilligung nur, wenn ausdrücklich bestätigt wurde, dass ein Nachweis vorliegt (consentConfirmed).
 */
export async function importRecords(
  workspaceId: string,
  records: ImportRecord[],
  opts: { tag: string; source: string; consentConfirmed: boolean; extraListId?: string | null },
): Promise<CsvImportResult> {
  const res: CsvImportResult = { created: 0, updated: 0, skipped: 0, suppressed: 0, listsCreated: 0 };
  const listCache = new Map<string, string>();

  async function listIdFor(name: string) {
    const n = name.trim().slice(0, 120);
    if (!n) return null;
    if (listCache.has(n)) return listCache.get(n)!;
    let l = await db.contactList.findUnique({ where: { workspaceId_name: { workspaceId, name: n } } });
    if (!l) {
      l = await db.contactList.create({ data: { workspaceId, name: n, source: opts.source } });
      res.listsCreated++;
    }
    listCache.set(n, l.id);
    return l.id;
  }

  const allAttrs: Record<string, unknown> = {};
  for (const r of records) Object.assign(allAttrs, r.attributes);
  await ensureProperties(workspaceId, allAttrs, opts.source);

  for (const r of records) {
    const email = normalizeEmail(r.email);
    if (!email) {
      res.skipped++;
      continue;
    }
    const existing = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
    const std = { firstName: r.firstName, lastName: r.lastName, phone: r.phone, company: r.company };
    const consent = opts.consentConfirmed && r.consent && !r.blacklisted;
    let contactId: string;
    if (existing) {
      const fill = Object.fromEntries(Object.entries(std).filter(([k, v]) => v && !existing[k as keyof typeof std]));
      await db.contact.update({
        where: { id: existing.id },
        data: {
          ...fill,
          attributes: { ...((existing.attributes as Record<string, unknown>) ?? {}), ...r.attributes } as Prisma.InputJsonObject,
          tags: Array.from(new Set([...existing.tags, ...r.tags, opts.tag])).slice(0, 50),
          ...(consent && !existing.consentEmailAt ? { consentEmailAt: new Date(), consentSource: `${opts.source} (Nachweis bestätigt)` } : {}),
          ...(r.blacklisted && !existing.unsubscribedAt ? { unsubscribedAt: new Date() } : {}),
        },
      });
      contactId = existing.id;
      res.updated++;
    } else {
      const c = await db.contact.create({
        data: {
          workspaceId,
          email,
          ...Object.fromEntries(Object.entries(std).filter(([, v]) => v)),
          attributes: r.attributes as Prisma.InputJsonObject,
          tags: Array.from(new Set([...r.tags, opts.tag])).slice(0, 50),
          source: opts.source,
          ...(consent ? { consentEmailAt: new Date(), consentSource: `${opts.source} (Nachweis bestätigt)` } : {}),
          ...(r.blacklisted ? { unsubscribedAt: new Date() } : {}),
        },
      });
      // Import-Ereignis: löst Prozesse nur aus, wenn ein Auslöser ausdrücklich includeImports erlaubt
      await emitEvent({ workspaceId, type: "contact.created", objectType: "contact", objectId: c.id, data: { import: true, source: opts.source } });
      contactId = c.id;
      res.created++;
    }
    if (r.blacklisted) {
      await db.suppression.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: { workspaceId, email, reason: "unsubscribed", source: opts.source },
        update: {},
      });
      res.suppressed++;
    }
    const listIds = [...(await Promise.all(r.lists.map(listIdFor))), opts.extraListId ?? null].filter((x): x is string => !!x);
    if (listIds.length) {
      await db.contactListMember.createMany({ data: listIds.map((listId) => ({ listId, contactId })), skipDuplicates: true });
    }
  }
  return res;
}

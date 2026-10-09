import "server-only";
import { emitEvent } from "@/lib/events";
import { NextResponse } from "next/server";
import type { Contact, Prisma } from "@prisma/client";
import { db } from "./db";
import { ApiAuthError, apiError, authenticateApiKey, type ApiAuth, type Scope } from "./apikey";
import { normalizeEmail, splitBrevoAttributes, toBrevoAttributes } from "./migrate/brevo-map";
import { ensureProperties } from "./properties";
import { errMessage, log } from "@/lib/log";

// Gemeinsame Logik der Brevo-kompatiblen Kontakte-API (/api/brevo/v3/contacts/**).

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Führt einen API-Handler mit Schlüsselprüfung aus und übersetzt Fehler ins Brevo-Format. */
export async function withApi(req: Request, scope: Scope, fn: (auth: ApiAuth & { keyName: string }) => Promise<Response>) {
  try {
    const auth = await authenticateApiKey(req, scope);
    const key = await db.apiKey.findUnique({ where: { id: auth.keyId }, select: { name: true } });
    return await fn({ ...auth, keyName: key?.name ?? "api" });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiError(err.status, err.status === 401 ? "unauthorized" : err.status === 403 ? "permission_denied" : "too_many_requests", err.message);
    }
    if (err instanceof ApiError) return apiError(err.status, err.code, err.message);
    log.error("contacts api error", { error: errMessage(err) });
    return apiError(500, "internal_error", "Internal error");
  }
}

export async function readJson(req: Request, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "invalid_parameter", "Body too large");
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_parameter", "Invalid JSON body");
  }
}

export const noContent = () => new NextResponse(null, { status: 204 });

/** Kontakt per E-Mail oder ID im Workspace finden. */
export async function findContact(workspaceId: string, identifier: string) {
  const id = decodeURIComponent(identifier).trim();
  const email = normalizeEmail(id);
  const c = email
    ? await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } })
    : await db.contact.findFirst({ where: { workspaceId, id } });
  if (!c) throw new ApiError(404, "document_not_found", "Contact does not exist");
  return c;
}

/** Brevo-numerische Listen-IDs → eigene Listen (nur im Workspace). Unbekannte → Fehler. */
export async function resolveLists(workspaceId: string, raw: unknown): Promise<{ id: string; numericId: number }[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 100) throw new ApiError(400, "invalid_parameter", "listIds must be an array of integers");
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) throw new ApiError(400, "invalid_parameter", "listIds must be an array of integers");
  if (!nums.length) return [];
  const lists = await db.contactList.findMany({ where: { workspaceId, numericId: { in: nums } }, select: { id: true, numericId: true } });
  const missing = nums.filter((n) => !lists.some((l) => l.numericId === n));
  if (missing.length) throw new ApiError(404, "document_not_found", `List ID(s) ${missing.join(", ")} not found`);
  return lists;
}

export async function contactJson(c: Contact) {
  const [memberships, suppression] = await Promise.all([
    db.contactListMember.findMany({ where: { contactId: c.id }, select: { list: { select: { numericId: true } } } }),
    c.email ? db.suppression.findUnique({ where: { workspaceId_email: { workspaceId: c.workspaceId, email: c.email } } }) : null,
  ]);
  return {
    id: c.id,
    email: c.email,
    emailBlacklisted: !!c.unsubscribedAt || !!suppression,
    smsBlacklisted: false,
    createdAt: c.createdAt.toISOString(),
    modifiedAt: c.updatedAt.toISOString(),
    attributes: toBrevoAttributes(c),
    listIds: memberships.map((m) => m.list.numericId).sort((a, b) => a - b),
    listUnsubscribed: [],
  };
}

type WriteInput = {
  attributes?: unknown;
  emailBlacklisted?: unknown;
  listIds?: unknown;
  unlinkListIds?: unknown;
};

/**
 * Attribute, Sperrstatus und Listen auf einen Kontakt anwenden.
 * Einwilligung wird NUR gesetzt, wenn das DOI-Attribut sie ausdrücklich belegt.
 */
export async function applyContactWrite(workspaceId: string, contactId: string | null, email: string, input: WriteInput, keyName: string) {
  const { fields, extra, doi, rejected } = splitBrevoAttributes(input.attributes);
  if (rejected.length) throw new ApiError(400, "invalid_parameter", `Invalid attribute(s): ${rejected.slice(0, 5).join(", ")}`);
  const addLists = await resolveLists(workspaceId, input.listIds);
  const removeLists = await resolveLists(workspaceId, input.unlinkListIds);
  if (input.emailBlacklisted !== undefined && typeof input.emailBlacklisted !== "boolean") {
    throw new ApiError(400, "invalid_parameter", "emailBlacklisted must be a boolean");
  }
  const source = `api:${keyName}`.slice(0, 200);
  await ensureProperties(workspaceId, extra, "api");

  return db.$transaction(async (tx) => {
    const existing = contactId ? await tx.contact.findUniqueOrThrow({ where: { id: contactId } }) : null;
    const attributes = { ...((existing?.attributes as Record<string, unknown> | null) ?? {}), ...extra } as Prisma.InputJsonObject;
    const data: Prisma.ContactUncheckedUpdateInput = { ...fields, attributes };
    if (doi && !existing?.consentEmailAt) {
      data.consentEmailAt = new Date();
      data.consentSource = source;
    }
    if (input.emailBlacklisted === true) data.unsubscribedAt = existing?.unsubscribedAt ?? new Date();
    if (input.emailBlacklisted === false) data.unsubscribedAt = null;

    const contact = existing
      ? await tx.contact.update({ where: { id: existing.id }, data })
      : await tx.contact.create({
          data: { ...(data as Prisma.ContactUncheckedCreateInput), workspaceId, email, source },
        });
    if (!existing) {
      await emitEvent({ workspaceId, type: "contact.created", objectType: "contact", objectId: contact.id, data: { source: "api" } }, tx);
    }

    if (input.emailBlacklisted === true) {
      await tx.suppression.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: { workspaceId, email, reason: "unsubscribed", source },
        update: {},
      });
    } else if (input.emailBlacklisted === false) {
      // Bounces/Spam-Beschwerden bleiben gesperrt; nur Abmeldungen lassen sich aufheben
      await tx.suppression.deleteMany({ where: { workspaceId, email, reason: { in: ["unsubscribed", "manual", "import"] } } });
    }
    if (addLists.length) {
      await tx.contactListMember.createMany({ data: addLists.map((l) => ({ listId: l.id, contactId: contact.id })), skipDuplicates: true });
    }
    if (removeLists.length) {
      await tx.contactListMember.deleteMany({ where: { contactId: contact.id, listId: { in: removeLists.map((l) => l.id) } } });
    }
    await tx.activity.create({
      data: {
        workspaceId,
        contactId: contact.id,
        type: "SYSTEM",
        body: existing ? `Über API aktualisiert (${keyName})` : `Über API angelegt (${keyName})`,
      },
    });
    return { contact, created: !existing };
  });
}

export async function listJson(l: { id: string; numericId: number; name: string; createdAt: Date }) {
  const [total, blacklisted] = await Promise.all([
    db.contactListMember.count({ where: { listId: l.id } }),
    db.contactListMember.count({ where: { listId: l.id, contact: { unsubscribedAt: { not: null } } } }),
  ]);
  return {
    id: l.numericId,
    name: l.name,
    totalBlacklisted: blacklisted,
    totalSubscribers: total,
    uniqueSubscribers: total,
    folderId: 1,
    createdAt: l.createdAt.toISOString(),
  };
}

export async function findList(workspaceId: string, listId: string) {
  const n = Number(listId);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, "invalid_parameter", "listId must be an integer");
  const l = await db.contactList.findFirst({ where: { workspaceId, numericId: n } });
  if (!l) throw new ApiError(404, "document_not_found", "List ID does not exist");
  return l;
}

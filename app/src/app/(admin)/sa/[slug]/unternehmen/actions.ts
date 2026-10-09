"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardOrRedirect, recordOrRedirect } from "@/lib/permissions/guard";
import { canSetOwner } from "@/lib/permissions/rules";
import { emitEvent } from "@/lib/events";
import { audit } from "@/lib/audit";
import { createCompany as createCompanyRecord, mergeCompanies } from "@/lib/objects/companies";
import { normalizeDomain } from "@/lib/objects/domain";
import { isValidOwner } from "@/lib/objects/defaults";
import { PROPERTY_TYPES, parseOptions } from "@/lib/properties";

const q = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const opt = (max = 200) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const companySchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(200),
  domain: opt(253),
  industry: opt(120),
  size: opt(60),
  phone: opt(50),
  address: opt(500),
  website: opt(300),
  ownerId: opt(60),
  lifecycleStage: opt(40),
});

function read(fd: FormData) {
  const g = (k: string) => (fd.get(k) as string | null) ?? undefined;
  const r = companySchema.safeParse({
    name: g("name"), domain: g("domain"), industry: g("industry"), size: g("size"), phone: g("phone"),
    address: g("address"), website: g("website"), ownerId: g("ownerId"), lifecycleStage: g("lifecycleStage"),
  });
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join(", "));
  const d = r.data;
  const domain = d.domain ? normalizeDomain(d.domain) : null;
  if (d.domain && !domain) throw new Error("Domain ist ungültig (Beispiel: firma.de)");
  return { ...d, domain };
}

async function checkRefs(workspaceId: string, d: { domain: string | null; ownerId: string | null; lifecycleStage: string | null }, selfId?: string) {
  if (d.domain) {
    const dup = await db.company.findFirst({ where: { workspaceId, domain: d.domain, NOT: selfId ? { id: selfId } : undefined } });
    if (dup) throw new Error(`Die Domain ${d.domain} gehört bereits zu „${dup.name}“. Ggf. zusammenführen.`);
  }
  if (d.ownerId && !(await isValidOwner(workspaceId, d.ownerId))) throw new Error("Zuständige Person ist nicht berechtigt.");
  if (d.lifecycleStage && !(await db.lifecycleStage.findFirst({ where: { workspaceId, key: d.lifecycleStage } }))) throw new Error("Unbekannte Lifecycle-Phase.");
}

export async function createCompany(slug: string, fd: FormData) {
  const { ws, access } = await guardOrRedirect(slug, { object: "companies", action: "edit" }, `/sa/${slug}/unternehmen`);
  let id: string;
  try {
    const d = read(fd);
    await checkRefs(ws.id, d);
    if (!canSetOwner(access.perms, "companies", { userId: access.userId, teamUserIds: access.teamUserIds }, d.ownerId)) throw new Error("Diese Person dürfen Sie nicht als Zuständige eintragen.");
    const c = await db.$transaction(async (tx) => {
      const created = await createCompanyRecord(ws.id, { name: d.name, domain: d.domain, industry: d.industry, ownerId: d.ownerId, source: "manual" }, tx);
      return tx.company.update({ where: { id: created.id }, data: { size: d.size, phone: d.phone, address: d.address, website: d.website, lifecycleStage: d.lifecycleStage } });
    });
    id = c.id;
  } catch (e) {
    redirect(`/sa/${slug}/unternehmen?fehler=${q(msg(e))}`);
  }
  redirect(`/sa/${slug}/unternehmen/${id}?ok=${q("Unternehmen angelegt")}`);
}

export async function updateCompany(slug: string, id: string, fd: FormData) {
  const back = `/sa/${slug}/unternehmen/${id}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "companies", action: "edit" }, back);
  const current = await db.company.findFirst({ where: { id, workspaceId: ws.id }, select: { ownerId: true } });
  recordOrRedirect(access, "companies", "edit", current?.ownerId, back);
  try {
    const d = read(fd);
    await checkRefs(ws.id, d, id);
    if (d.ownerId !== (current?.ownerId ?? null) && !canSetOwner(access.perms, "companies", { userId: access.userId, teamUserIds: access.teamUserIds }, d.ownerId)) {
      throw new Error("Diese Person dürfen Sie nicht als Zuständige eintragen.");
    }
    const res = await db.company.updateMany({ where: { id, workspaceId: ws.id }, data: d });
    if (res.count === 0) throw new Error("Unternehmen nicht gefunden");
  } catch (e) {
    redirect(`${back}?fehler=${q(msg(e))}`);
  }
  revalidatePath(back);
  redirect(`${back}?ok=${q("Gespeichert")}`);
}

export async function saveCompanyAttributes(slug: string, id: string, fd: FormData) {
  const back = `/sa/${slug}/unternehmen/${id}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "companies", action: "edit" }, back);
  const company = await db.company.findFirst({ where: { id, workspaceId: ws.id } });
  if (!company) redirect(`${back}?fehler=${q("Unternehmen nicht gefunden")}`);
  recordOrRedirect(access, "companies", "edit", company.ownerId, back);
  const props = await db.propertyDefinition.findMany({ where: { workspaceId: ws.id, objectType: "company" } });
  const attrs = { ...((company.attributes as Record<string, unknown>) ?? {}) };
  for (const p of props) {
    const raw = fd.get(`attr_${p.key}`);
    if (p.type === "boolean") attrs[p.key] = raw === "on";
    else if (raw === null || String(raw).trim() === "") delete attrs[p.key];
    else if (p.type === "number") {
      const n = Number(String(raw).replace(",", "."));
      if (Number.isFinite(n)) attrs[p.key] = n;
    } else if (p.type === "select") {
      const v = String(raw);
      if (parseOptions(p.options).some((o) => o.value === v)) attrs[p.key] = v;
    } else attrs[p.key] = String(raw).slice(0, 2000);
  }
  await db.company.update({ where: { id: company.id }, data: { attributes: attrs as Prisma.InputJsonObject } });
  redirect(`${back}?ok=${q("Felder gespeichert")}`);
}

export async function createCompanyField(slug: string, fd: FormData) {
  // Eigene Felder sind Struktur (wie Listen & Felder) → Recht lists.edit
  const { ws } = await guardOrRedirect(slug, { object: "lists", action: "edit" }, `/sa/${slug}/unternehmen`);
  const r = z
    .object({
      label: z.string().trim().min(1, "Bezeichnung fehlt").max(80),
      key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "Schlüssel: Buchstaben, Ziffern, _"),
      type: z.enum(PROPERTY_TYPES),
    })
    .safeParse({ label: fd.get("label"), key: fd.get("key"), type: fd.get("type") });
  const back = String(fd.get("back") ?? `/sa/${slug}/unternehmen`);
  const safeBack = back.startsWith(`/sa/${slug}/unternehmen`) ? back : `/sa/${slug}/unternehmen`;
  if (!r.success) redirect(`${safeBack}?fehler=${q(r.error.issues[0].message)}`);
  await db.propertyDefinition.upsert({
    where: { workspaceId_objectType_key: { workspaceId: ws.id, objectType: "company", key: r.data.key } },
    create: { workspaceId: ws.id, objectType: "company", key: r.data.key, label: r.data.label, type: r.data.type, source: "manuell" },
    update: { label: r.data.label },
  });
  redirect(`${safeBack}?ok=${q("Feld angelegt")}`);
}

export async function linkContact(slug: string, companyId: string, fd: FormData) {
  const back = `/sa/${slug}/unternehmen/${companyId}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "contacts", action: "edit" }, back);
  const contactId = String(fd.get("contactId") ?? "");
  const [company, contact] = await Promise.all([
    db.company.findFirst({ where: { id: companyId, workspaceId: ws.id }, select: { id: true, ownerId: true } }),
    db.contact.findFirst({ where: { id: contactId, workspaceId: ws.id }, select: { id: true, companyId: true, ownerId: true } }),
  ]);
  if (!company || !contact) redirect(`${back}?fehler=${q("Kontakt oder Unternehmen nicht gefunden")}`);
  recordOrRedirect(access, "contacts", "edit", contact.ownerId, back);
  recordOrRedirect(access, "companies", "read", company.ownerId, back);
  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id: contact.id }, data: { companyId: company.id } });
    await emitEvent({ workspaceId: ws.id, type: "contact.property_changed", objectType: "contact", objectId: contact.id, data: { field: "companyId", from: contact.companyId, to: company.id } }, tx);
  });
  redirect(`${back}?ok=${q("Kontakt verknüpft")}`);
}

export async function unlinkContact(slug: string, companyId: string, contactId: string) {
  const back = `/sa/${slug}/unternehmen/${companyId}`;
  const { ws, access } = await guardOrRedirect(slug, { object: "contacts", action: "edit" }, back);
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId: ws.id }, select: { ownerId: true } });
  recordOrRedirect(access, "contacts", "edit", contact?.ownerId, back);
  await db.$transaction(async (tx) => {
    const r = await tx.contact.updateMany({ where: { id: contactId, workspaceId: ws.id, companyId }, data: { companyId: null } });
    if (r.count) await emitEvent({ workspaceId: ws.id, type: "contact.property_changed", objectType: "contact", objectId: contactId, data: { field: "companyId", from: companyId, to: null } }, tx);
  });
  redirect(`/sa/${slug}/unternehmen/${companyId}?ok=${q("Verknüpfung gelöst")}`);
}

export async function mergeCompany(slug: string, keepId: string, fd: FormData) {
  // Zusammenführen löscht die Dublette → Löschrecht nötig
  const back = `/sa/${slug}/unternehmen/${keepId}`;
  const { ws, access, user } = await guardOrRedirect(slug, { object: "companies", action: "delete" }, back);
  const dropId = String(fd.get("dropId") ?? "");
  const [keep, drop] = await Promise.all([
    db.company.findFirst({ where: { id: keepId, workspaceId: ws.id }, select: { ownerId: true } }),
    db.company.findFirst({ where: { id: dropId, workspaceId: ws.id }, select: { ownerId: true } }),
  ]);
  recordOrRedirect(access, "companies", "edit", keep?.ownerId, back);
  recordOrRedirect(access, "companies", "delete", drop?.ownerId, back);
  if (fd.get("confirm") !== "on") redirect(`/sa/${slug}/unternehmen/${keepId}?fehler=${q("Bitte das Zusammenführen bestätigen")}`);
  try {
    await mergeCompanies(ws.id, keepId, dropId, `user:${user.id}`);
  } catch (e) {
    redirect(`/sa/${slug}/unternehmen/${keepId}?fehler=${q(msg(e))}`);
  }
  redirect(`/sa/${slug}/unternehmen/${keepId}?ok=${q("Zusammengeführt")}`);
}

export async function deleteCompany(slug: string, id: string) {
  const back = `/sa/${slug}/unternehmen/${id}`;
  const { ws, access, user } = await guardOrRedirect(slug, { object: "companies", action: "delete" }, back);
  const current = await db.company.findFirst({ where: { id, workspaceId: ws.id }, select: { ownerId: true } });
  recordOrRedirect(access, "companies", "delete", current?.ownerId, back);
  const r = await db.company.deleteMany({ where: { id, workspaceId: ws.id } });
  if (r.count) await audit({ workspaceId: ws.id, actor: `user:${user.id}`, action: "company.deleted", target: id });
  redirect(`/sa/${slug}/unternehmen?ok=${q("Unternehmen gelöscht (Kontakte bleiben erhalten)")}`);
}

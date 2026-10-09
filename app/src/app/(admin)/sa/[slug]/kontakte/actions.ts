"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, can } from "@/lib/permissions";
import { assertOwnerAssignable, assertRecord, forbiddenToState, guard } from "@/lib/permissions/guard";
import { parseCsv } from "@/lib/a-csv";
import { parseTags } from "@/lib/a-format";
import { fireTrigger } from "@/lib/automation";
import { emitEvent, emitEvents } from "@/lib/events";
import { associateByDomain } from "@/lib/objects/companies";
import { ensureDefaultsOnce, isValidOwner } from "@/lib/objects/defaults";
import { isBackward } from "@/lib/objects/lifecycle";
import { ErasureBlockedError, eraseContact } from "@/lib/privacy/erase";

const opt = (max = 200) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const contactSchema = z.object({
  firstName: opt(),
  lastName: opt(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "Ungültige E-Mail-Adresse"),
  phone: opt(50),
  company: opt(),
  source: opt(100),
  tags: z.string().max(1000).optional(),
  notes: opt(5000),
});

function readContact(fd: FormData) {
  const get = (k: string) => (fd.get(k) as string | null) ?? undefined;
  const parsed = contactSchema.safeParse({
    firstName: get("firstName"),
    lastName: get("lastName"),
    email: get("email"),
    phone: get("phone"),
    company: get("company"),
    source: get("source"),
    tags: get("tags"),
    notes: get("notes"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  const { tags, ...rest } = parsed.data;
  return { ...rest, tags: parseTags(tags) };
}

export async function createContact(slug: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  const data = readContact(fd);
  if (!data.firstName && !data.lastName && !data.email) throw new Error("Name oder E-Mail angeben");
  if (data.email) {
    const exists = await db.contact.findFirst({ where: { workspaceId: ws.id, email: data.email } });
    if (exists) redirect(`/sa/${slug}/kontakte/${exists.id}`);
  }
  const c = await db.$transaction(async (tx) => {
    // Wer nur eigene/Team-Kontakte bearbeiten darf, wird automatisch zuständig (sonst verliert er den Zugriff nicht, aber Klarheit)
    const ownerId = access.perms.objects.contacts.edit === "all" ? null : access.userId;
    const created = await tx.contact.create({ data: { ...data, workspaceId: ws.id, source: data.source ?? "manuell", ownerId } });
    await tx.activity.create({ data: { workspaceId: ws.id, contactId: created.id, type: "SYSTEM", body: "Kontakt angelegt" } });
    await emitEvent({ workspaceId: ws.id, type: "contact.created", objectType: "contact", objectId: created.id, data: { source: "manual" } }, tx);
    return created;
  });
  // Unternehmen per Firmen-Domain zuordnen (Freemail ausgenommen); Fehler blockieren das Anlegen nicht
  await associateByDomain(c.id).catch((e) => console.error("Domain-Zuordnung fehlgeschlagen:", e));
  for (const tag of c.tags) await fireTrigger(ws.id, "TAG_ADDED", { contactId: c.id, tag });
  revalidatePath(`/sa/${slug}/kontakte`);
  redirect(`/sa/${slug}/kontakte/${c.id}`);
}

export async function updateContact(slug: string, id: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  const data = readContact(fd);
  if (data.email) {
    const dup = await db.contact.findFirst({ where: { workspaceId: ws.id, email: data.email, NOT: { id } } });
    if (dup) throw new Error("Diese E-Mail-Adresse gehört bereits zu einem anderen Kontakt");
  }
  const before = await db.contact.findFirst({ where: { id, workspaceId: ws.id } });
  if (!before) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", before.ownerId);
  const CORE = ["firstName", "lastName", "email", "phone", "company"] as const;
  await db.$transaction(async (tx) => {
    const res = await tx.contact.updateMany({ where: { id, workspaceId: ws.id }, data });
    if (res.count === 0) throw new Error("Kontakt nicht gefunden");
    const changes = CORE.filter((f) => (before[f] ?? null) !== (data[f] ?? null));
    await emitEvents(
      changes.map((f) => ({ workspaceId: ws.id, type: "contact.property_changed" as const, objectType: "contact" as const, objectId: id, data: { field: f, from: before[f] ?? null, to: data[f] ?? null } })),
      tx,
    );
  });
  for (const tag of data.tags.filter((t) => !before.tags.includes(t))) await fireTrigger(ws.id, "TAG_ADDED", { contactId: id, tag });
  revalidatePath(`/sa/${slug}/kontakte/${id}`);
}

export async function addNote(slug: string, id: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  const body = z.string().trim().min(1).max(5000).parse(fd.get("body"));
  const contact = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true, ownerId: true } });
  if (!contact) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", contact.ownerId);
  await db.activity.create({ data: { workspaceId: ws.id, contactId: id, type: "NOTE", body } });
  revalidatePath(`/sa/${slug}/kontakte/${id}`);
}

export async function deleteContact(slug: string, id: string) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "delete" });
  const c = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { ownerId: true } });
  if (!c) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "delete", c.ownerId);
  // Vollständige Löschung (Art. 17 DSGVO) inkl. Daten ohne Fremdschlüssel; Belege bleiben anonymisiert
  try {
    await eraseContact(ws.id, id, `user:${access.userId}`);
  } catch (e) {
    if (e instanceof ErasureBlockedError) redirect(`/sa/${slug}/kontakte/${id}?fehler=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/sa/${slug}/kontakte`);
  redirect(`/sa/${slug}/kontakte`);
}

export type ImportState = { message?: string; error?: string };

const MAX_IMPORT = 5000;

export async function importCsv(slug: string, _prev: ImportState, fd: FormData): Promise<ImportState> {
  let ctx;
  try {
    ctx = await guard(slug, { special: "import" });
    if (!can(ctx.access, "contacts", "edit")) throw new ForbiddenError("Für den Import fehlt das Recht, Kontakte zu bearbeiten.");
  } catch (e) {
    const f = forbiddenToState(e);
    if (f) return f;
    throw e;
  }
  const { ws, access } = ctx;
  let text = (fd.get("csv") as string | null) ?? "";
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) return { error: "Datei ist größer als 5 MB" };
    text = await file.text();
  }
  const rows = parseCsv(text);
  if (rows.length < 2) return { error: "Keine Datenzeilen gefunden (erste Zeile = Spaltennamen)" };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const idx = {
    firstName: col("firstName"),
    lastName: col("lastName"),
    email: col("email"),
    phone: col("phone"),
    company: col("company"),
    tags: col("tags"),
  };
  if (idx.email < 0 && idx.firstName < 0 && idx.lastName < 0) {
    return { error: "Spalten fehlen. Erwartet: firstName,lastName,email,phone,company,tags" };
  }
  const data = rows.slice(1, MAX_IMPORT + 1);
  let created = 0, updated = 0, skipped = 0;
  const importTag = `import-${new Date().toISOString().slice(0, 10)}`;

  for (const r of data) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const email = cell(idx.email).toLowerCase() || null;
    if (email && !z.email().safeParse(email).success) { skipped++; continue; }
    const record = {
      firstName: cell(idx.firstName).slice(0, 200) || null,
      lastName: cell(idx.lastName).slice(0, 200) || null,
      phone: cell(idx.phone).slice(0, 50) || null,
      company: cell(idx.company).slice(0, 200) || null,
    };
    if (!email && !record.firstName && !record.lastName) { skipped++; continue; }
    const tags = parseTags(cell(idx.tags));
    if (email) {
      const existing = await db.contact.findFirst({ where: { workspaceId: ws.id, email } });
      // Bestehende Kontakte außerhalb der eigenen Reichweite nicht anfassen
      if (existing && !can(access, "contacts", "edit", existing.ownerId)) { skipped++; continue; }
      if (existing) {
        await db.contact.update({
          where: { id: existing.id },
          data: {
            firstName: existing.firstName ?? record.firstName,
            lastName: existing.lastName ?? record.lastName,
            phone: existing.phone ?? record.phone,
            company: existing.company ?? record.company,
            tags: Array.from(new Set([...existing.tags, ...tags])),
          },
        });
        updated++;
        continue;
      }
    }
    // Hinweis: Import setzt KEINE E-Mail-Einwilligung. Die muss nachweisbar separat erfasst werden.
    await db.$transaction(async (tx) => {
      const nc = await tx.contact.create({
        data: { ...record, email, tags: Array.from(new Set([...tags, importTag])), workspaceId: ws.id, source: "csv-import" },
      });
      // import: true → Prozesse können Importe gezielt ausschließen (z. B. keine Willkommensmail)
      await emitEvent({ workspaceId: ws.id, type: "contact.created", objectType: "contact", objectId: nc.id, data: { source: "csv-import", import: true } }, tx);
    });
    created++;
  }
  revalidatePath(`/sa/${slug}/kontakte`);
  const cut = rows.length - 1 > MAX_IMPORT ? ` Nur die ersten ${MAX_IMPORT} Zeilen verarbeitet.` : "";
  return { message: `${created} neu, ${updated} ergänzt, ${skipped} übersprungen.${cut}` };
}

// ---------- Vertrieb: Lifecycle, Zuständige, Unternehmen ----------

export async function setLifecycle(slug: string, id: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  await ensureDefaultsOnce(ws.id);
  const to = z.string().trim().min(1).max(40).parse(fd.get("lifecycleStage"));
  const [contact, stages] = await Promise.all([
    db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true, lifecycleStage: true, ownerId: true } }),
    db.lifecycleStage.findMany({ where: { workspaceId: ws.id } }),
  ]);
  if (!contact) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", contact.ownerId);
  if (!stages.some((s) => s.key === to)) throw new Error("Unbekannte Lifecycle-Phase");
  if (contact.lifecycleStage === to) return;
  // Standard: nur vorwärts. Rückschritt nur mit ausdrücklicher Bestätigung.
  if (isBackward(stages, contact.lifecycleStage, to) && fd.get("confirmBack") !== "on") {
    throw new Error("Rückschritt in eine frühere Phase bitte ausdrücklich bestätigen.");
  }
  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id: contact.id }, data: { lifecycleStage: to } });
    await tx.activity.create({ data: { workspaceId: ws.id, contactId: contact.id, type: "SYSTEM", body: `Lifecycle-Phase: ${contact.lifecycleStage} → ${to}` } });
    await emitEvent({ workspaceId: ws.id, type: "contact.lifecycle_changed", objectType: "contact", objectId: contact.id, data: { from: contact.lifecycleStage, to } }, tx);
  });
  revalidatePath(`/sa/${slug}/kontakte/${id}`);
}

export async function setContactOwner(slug: string, id: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  const ownerId = String(fd.get("ownerId") ?? "") || null;
  if (ownerId && !(await isValidOwner(ws.id, ownerId))) throw new Error("Zuständige Person ist nicht berechtigt.");
  const before = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { ownerId: true } });
  if (!before) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", before.ownerId);
  assertOwnerAssignable(access, "contacts", ownerId);
  if (before.ownerId === ownerId) return;
  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: { ownerId } });
    await emitEvent({ workspaceId: ws.id, type: "contact.property_changed", objectType: "contact", objectId: id, data: { field: "ownerId", from: before.ownerId, to: ownerId } }, tx);
  });
  revalidatePath(`/sa/${slug}/kontakte/${id}`);
}

export async function setContactCompany(slug: string, id: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  const companyId = String(fd.get("companyId") ?? "") || null;
  if (companyId && !(await db.company.findFirst({ where: { id: companyId, workspaceId: ws.id }, select: { id: true } }))) throw new Error("Unternehmen nicht gefunden");
  const before = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { companyId: true, ownerId: true } });
  if (!before) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", before.ownerId);
  if (before.companyId === companyId) return;
  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: { companyId } });
    await emitEvent({ workspaceId: ws.id, type: "contact.property_changed", objectType: "contact", objectId: id, data: { field: "companyId", from: before.companyId, to: companyId } }, tx);
  });
  revalidatePath(`/sa/${slug}/kontakte/${id}`);
}

export async function matchCompanyByDomain(slug: string, id: string) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" } as const);
  const c = await db.contact.findFirst({ where: { id, workspaceId: ws.id }, select: { id: true, ownerId: true } });
  if (!c) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", c.ownerId);
  await associateByDomain(c.id);
  revalidatePath(`/sa/${slug}/kontakte/${id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { assertRecord, guard, guardOrRedirect, withScope } from "@/lib/permissions/guard";
import { parseCsv } from "@/lib/a-csv";
import { normalizeAttrKey, normalizeEmail } from "@/lib/migrate/brevo-map";
import { detectFormat, rowsToRecords, suggestMapping, type CsvFormat, type Target } from "@/lib/migrate/csv";
import { importRecords, type CsvImportResult } from "@/lib/migrate/csv-import";
import { cancelBrevoImport as cancelImport, startBrevoImport as startImport } from "@/lib/migrate/brevo-import";
import { PROPERTY_TYPES } from "@/lib/properties";
import { ownListIds } from "@/lib/lists";

const q = encodeURIComponent;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Importe (Brevo, CSV-Wechsel) brauchen das Sonderrecht „Daten importieren“ und Kontakte bearbeiten. */
async function requireImporter(slug: string) {
  const { ws, user, access } = await guard(slug, { special: "import" });
  if (!can(access, "contacts", "edit")) throw new Error("Für den Import fehlt das Recht, Kontakte zu bearbeiten.");
  return { ws, user, access };
}

// ---------- Listen ----------

const nameSchema = z.string().trim().min(1, "Name fehlt").max(120);

export async function createList(slug: string, fd: FormData) {
  const { ws } = await guardOrRedirect(slug, { object: "lists", action: "edit" }, `/sa/${slug}/listen`);
  const name = nameSchema.safeParse(fd.get("name"));
  if (!name.success) redirect(`/sa/${slug}/listen?fehler=${q(name.error.issues[0].message)}`);
  const dup = await db.contactList.findUnique({ where: { workspaceId_name: { workspaceId: ws.id, name: name.data } } });
  if (dup) redirect(`/sa/${slug}/listen?fehler=${q("Eine Liste mit diesem Namen gibt es schon")}`);
  const l = await db.contactList.create({ data: { workspaceId: ws.id, name: name.data, source: "manuell" } });
  redirect(`/sa/${slug}/listen/${l.id}?ok=${q("Liste angelegt")}`);
}

export async function renameList(slug: string, listId: string, fd: FormData) {
  const { ws } = await guardOrRedirect(slug, { object: "lists", action: "edit" }, `/sa/${slug}/listen/${listId}`);
  const name = nameSchema.safeParse(fd.get("name"));
  const back = `/sa/${slug}/listen/${listId}`;
  if (!name.success) redirect(`${back}?fehler=${q(name.error.issues[0].message)}`);
  const dup = await db.contactList.findFirst({ where: { workspaceId: ws.id, name: name.data, NOT: { id: listId } } });
  if (dup) redirect(`${back}?fehler=${q("Eine Liste mit diesem Namen gibt es schon")}`);
  await db.contactList.updateMany({ where: { id: listId, workspaceId: ws.id }, data: { name: name.data } });
  redirect(`${back}?ok=${q("Umbenannt")}`);
}

export async function deleteList(slug: string, listId: string) {
  const { ws } = await guardOrRedirect(slug, { object: "lists", action: "delete" }, `/sa/${slug}/listen/${listId}`);
  await db.contactList.deleteMany({ where: { id: listId, workspaceId: ws.id } });
  redirect(`/sa/${slug}/listen?ok=${q("Liste gelöscht (Kontakte bleiben erhalten)")}`);
}

async function ownList(workspaceId: string, listId: string) {
  const l = await db.contactList.findFirst({ where: { id: listId, workspaceId } });
  if (!l) throw new Error("Liste nicht gefunden");
  return l;
}

/** Mitglieder hinzufügen: per E-Mail-Liste, Tag oder alle Kontakte. */
export async function addMembers(slug: string, listId: string, fd: FormData) {
  const { ws, access } = await guardOrRedirect(slug, { object: "lists", action: "edit" }, `/sa/${slug}/listen/${listId}`);
  // Nur Kontakte in der eigenen Lese-Reichweite übernehmen
  const scoped = <W extends object>(w: W) => withScope(w, access, "contacts");
  const back = `/sa/${slug}/listen/${listId}`;
  await ownList(ws.id, listId);
  const mode = String(fd.get("mode") ?? "emails");
  let contactIds: string[] = [];
  let unknown = 0;
  if (mode === "emails") {
    const lines = String(fd.get("emails") ?? "").split(/[\s,;]+/).map(normalizeEmail);
    const valid = Array.from(new Set(lines.filter((e): e is string => !!e))).slice(0, 5000);
    const rows = await db.contact.findMany({ where: scoped({ workspaceId: ws.id, email: { in: valid } }), select: { id: true } });
    contactIds = rows.map((r) => r.id);
    unknown = valid.length - rows.length;
  } else if (mode === "tag") {
    const tag = String(fd.get("tag") ?? "").trim();
    if (!tag) redirect(`${back}?fehler=${q("Bitte einen Tag wählen")}`);
    contactIds = (await db.contact.findMany({ where: scoped({ workspaceId: ws.id, tags: { has: tag } }), select: { id: true } })).map((r) => r.id);
  } else if (mode === "all") {
    contactIds = (await db.contact.findMany({ where: scoped({ workspaceId: ws.id }), select: { id: true } })).map((r) => r.id);
  }
  const res = await db.contactListMember.createMany({ data: contactIds.map((contactId) => ({ listId, contactId })), skipDuplicates: true });
  redirect(`${back}?ok=${q(`${res.count} hinzugefügt${unknown ? `, ${unknown} E-Mail(s) ohne Kontakt übersprungen` : ""}`)}`);
}

export async function removeMember(slug: string, listId: string, contactId: string) {
  const { ws } = await guard(slug, { object: "lists", action: "edit" });
  await ownList(ws.id, listId);
  await db.contactListMember.deleteMany({ where: { listId, contactId, contact: { workspaceId: ws.id } } });
  revalidatePath(`/sa/${slug}/listen/${listId}`);
}

// ---------- Eigene Felder ----------

const propSchema = z.object({
  key: z.string().trim().min(1, "Schlüssel fehlt").max(50),
  label: z.string().trim().min(1, "Bezeichnung fehlt").max(120),
  type: z.enum(PROPERTY_TYPES),
  options: z.string().max(5000).optional(),
});

function parseOptionLines(raw?: string) {
  return (raw ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((v) => ({ value: v, label: v }));
}

export async function saveProperty(slug: string, propertyId: string | null, fd: FormData) {
  const { ws } = await guardOrRedirect(slug, { object: "lists", action: "edit" }, `/sa/${slug}/listen`);
  const back = `/sa/${slug}/listen`;
  const p = propSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) redirect(`${back}?fehler=${q(p.error.issues[0].message)}`);
  const key = normalizeAttrKey(p.data.key);
  if (!key) redirect(`${back}?fehler=${q("Schlüssel: nur A–Z, 0–9, _ und - (max. 50 Zeichen)")}`);
  const options = p.data.type === "select" ? parseOptionLines(p.data.options) : undefined;
  if (p.data.type === "select" && !options?.length) redirect(`${back}?fehler=${q("Auswahlfeld braucht mindestens eine Option")}`);
  if (propertyId) {
    await db.propertyDefinition.updateMany({
      where: { id: propertyId, workspaceId: ws.id },
      data: { label: p.data.label, type: p.data.type, options: options ?? undefined },
    });
  } else {
    const dup = await db.propertyDefinition.findUnique({ where: { workspaceId_objectType_key: { workspaceId: ws.id, objectType: "contact", key } } });
    if (dup) redirect(`${back}?fehler=${q(`Feld ${key} gibt es schon`)}`);
    await db.propertyDefinition.create({ data: { workspaceId: ws.id, objectType: "contact", key, label: p.data.label, type: p.data.type, options, source: "manuell" } });
  }
  redirect(`${back}?ok=${q("Feld gespeichert")}#felder`);
}

export async function deleteProperty(slug: string, propertyId: string) {
  const { ws } = await guardOrRedirect(slug, { object: "lists", action: "delete" }, `/sa/${slug}/listen`);
  await db.propertyDefinition.deleteMany({ where: { id: propertyId, workspaceId: ws.id } });
  // Werte in Kontakten bleiben erhalten (kein Datenverlust); sie erscheinen wieder, wenn das Feld neu angelegt wird
  redirect(`/sa/${slug}/listen?ok=${q("Feld entfernt – vorhandene Werte bleiben in den Kontakten gespeichert")}#felder`);
}

// ---------- Kontaktdetail: Felder & Listen ----------

export async function saveContactAttributes(slug: string, contactId: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "contacts", action: "edit" });
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId: ws.id } });
  if (!contact) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", contact.ownerId);
  const props = await db.propertyDefinition.findMany({ where: { workspaceId: ws.id, objectType: "contact" } });
  const attrs = { ...((contact.attributes as Record<string, unknown>) ?? {}) };
  for (const p of props) {
    const raw = fd.get(`attr_${p.key}`);
    if (p.type === "boolean") {
      attrs[p.key] = raw === "on";
      continue;
    }
    const v = typeof raw === "string" ? raw.trim().slice(0, 2000) : "";
    if (!v) {
      delete attrs[p.key];
      continue;
    }
    if (p.type === "number") {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n)) attrs[p.key] = n;
    } else attrs[p.key] = v;
  }
  await db.contact.update({ where: { id: contact.id }, data: { attributes: attrs as Prisma.InputJsonObject } });
  revalidatePath(`/sa/${slug}/kontakte/${contactId}`);
}

export async function setContactLists(slug: string, contactId: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "lists", action: "edit" });
  const contact = await db.contact.findFirst({ where: { id: contactId, workspaceId: ws.id }, select: { id: true, ownerId: true } });
  if (!contact) throw new Error("Kontakt nicht gefunden");
  assertRecord(access, "contacts", "edit", contact.ownerId);
  const wanted = await ownListIds(ws.id, fd.getAll("listIds").map(String));
  const all = (await db.contactList.findMany({ where: { workspaceId: ws.id }, select: { id: true } })).map((l) => l.id);
  await db.$transaction([
    db.contactListMember.deleteMany({ where: { contactId, listId: { in: all.filter((id) => !wanted.includes(id)) } } }),
    db.contactListMember.createMany({ data: wanted.map((listId) => ({ listId, contactId })), skipDuplicates: true }),
  ]);
  revalidatePath(`/sa/${slug}/kontakte/${contactId}`);
}

// ---------- Wechsel: Brevo-Import ----------

export type BrevoState = { error?: string; ok?: string };

export async function startBrevoImport(slug: string, _prev: BrevoState, fd: FormData): Promise<BrevoState> {
  try {
    const { ws, user } = await requireImporter(slug);
    const key = String(fd.get("apiKey") ?? "").trim();
    if (!/^xkeysib-[A-Za-z0-9-]{20,}$/.test(key)) return { error: "Bitte einen Brevo-v3-REST-Schlüssel eingeben (beginnt mit „xkeysib-“)." };
    if (fd.get("confirm") !== "on") return { error: "Bitte bestätigen, dass die Daten übernommen werden dürfen." };
    await startImport(ws.id, key, user.name);
    revalidatePath(`/sa/${slug}/listen/wechsel`);
    return { ok: "Import gestartet. Der Worker (npm run worker) arbeitet ihn im Hintergrund ab." };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function cancelBrevoImport(slug: string) {
  const { ws } = await requireImporter(slug);
  await cancelImport(ws.id);
  redirect(`/sa/${slug}/listen/wechsel?ok=${q("Import abgebrochen, Schlüssel entfernt")}`);
}

// ---------- Wechsel: CSV ----------

export type CsvState = {
  step: "upload" | "mapping" | "done";
  error?: string;
  csv?: string;
  header?: string[];
  sample?: string[][];
  mapping?: Target[];
  format?: CsvFormat;
  rows?: number;
  result?: CsvImportResult;
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;

export async function csvStep(slug: string, prev: CsvState, fd: FormData): Promise<CsvState> {
  try {
    const { ws } = await requireImporter(slug);
    if (fd.get("reset") === "1") return { step: "upload" };

    if (prev.step === "upload" || !fd.get("csv")) {
      const file = fd.get("file");
      let text = "";
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_BYTES) return { step: "upload", error: "Datei ist größer als 5 MB." };
        text = await file.text();
      } else text = String(fd.get("text") ?? "");
      if (text.length > MAX_BYTES) return { step: "upload", error: "Text ist größer als 5 MB." };
      const rows = parseCsv(text);
      if (rows.length < 2) return { step: "upload", error: "Keine Daten gefunden (Kopfzeile + mindestens eine Zeile)." };
      if (rows.length - 1 > MAX_ROWS) return { step: "upload", error: `Maximal ${MAX_ROWS} Zeilen pro Import.` };
      const header = rows[0].map((h) => h.trim()).slice(0, 200);
      return { step: "mapping", csv: text, header, sample: rows.slice(1, 6), mapping: suggestMapping(header), format: detectFormat(header), rows: rows.length - 1 };
    }

    // Schritt 2: Import mit bestätigter Zuordnung
    const text = String(fd.get("csv") ?? "");
    if (text.length > MAX_BYTES) return { step: "upload", error: "Daten zu groß." };
    const rows = parseCsv(text);
    const header = rows[0] ?? [];
    const mapping: Target[] = header.map((_, i) => {
      const v = String(fd.get(`map_${i}`) ?? "skip");
      if (v.startsWith("attr:")) {
        const key = normalizeAttrKey(v.slice(5));
        return key ? (`attr:${key}` as Target) : "skip";
      }
      return (["skip", "email", "firstName", "lastName", "phone", "company", "tags", "lists", "blacklisted", "consent"].includes(v) ? v : "skip") as Target;
    });
    if (!mapping.includes("email")) return { ...prev, error: "Bitte eine Spalte als E-Mail zuordnen." };
    const records = rowsToRecords(rows.slice(1, MAX_ROWS + 1), mapping);
    const listIdRaw = String(fd.get("listId") ?? "");
    const [extraListId] = listIdRaw ? await ownListIds(ws.id, [listIdRaw]) : [];
    const format = (prev.format ?? "generic") as CsvFormat;
    const result = await importRecords(ws.id, records, {
      tag: `import-${format}-${new Date().toISOString().slice(0, 10)}`,
      source: `import:${format}-csv`,
      consentConfirmed: fd.get("consentConfirmed") === "on",
      extraListId: extraListId ?? null,
    });
    revalidatePath(`/sa/${slug}/kontakte`);
    return { step: "done", result };
  } catch (e) {
    return { ...prev, error: msg(e) };
  }
}

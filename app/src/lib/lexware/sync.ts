import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitInvoicePaid } from "../payments/paid-event";
import { audit } from "../audit";
import { emitEvent } from "../events";
import { getProfile, lexwareRequest, LexwareError } from "./client";
import { LEX_PATH, lexwareConfigured, lexwareDeeplink, type LexVoucherType } from "./config";
import {
  companyToLexware,
  invoiceToLexware,
  lexwareToLocal,
  mapVoucherStatus,
  personToLexware,
  type LexwareContact,
} from "./mapping";

// Synchronisierung CRM ↔ Lexware Office. Zuordnungen und Protokoll liegen in AppSetting
// (`lexware:<ws>` = Einstellungen/Protokoll, `lexware-map:<ws>` = IDs/Versionen) – kein Schlüssel in der DB.

export type LexState = {
  enabled: boolean;
  enabledBy?: string;
  lastSync?: string;
  log: { at: string; action: string; ok: boolean; detail: string }[];
};
type Ref = { id: string; version: number };
export type InvoiceRef = Ref & { type: LexVoucherType; status?: string; voucherNumber?: string; pushedAt: string; finalized: boolean };
export type LexMap = { contacts: Record<string, Ref>; companies: Record<string, Ref>; invoices: Record<string, InvoiceRef> };

const stateKey = (ws: string) => `lexware:${ws}`;
const mapKey = (ws: string) => `lexware-map:${ws}`;
const emptyMap = (): LexMap => ({ contacts: {}, companies: {}, invoices: {} });

export async function getState(workspaceId: string): Promise<LexState> {
  const s = await db.appSetting.findUnique({ where: { key: stateKey(workspaceId) } });
  const v = (s?.value ?? {}) as Partial<LexState>;
  return { enabled: !!v.enabled, enabledBy: v.enabledBy, lastSync: v.lastSync, log: Array.isArray(v.log) ? v.log : [] };
}

export async function getMap(workspaceId: string): Promise<LexMap> {
  const s = await db.appSetting.findUnique({ where: { key: mapKey(workspaceId) } });
  const v = (s?.value ?? {}) as Partial<LexMap>;
  return { contacts: v.contacts ?? {}, companies: v.companies ?? {}, invoices: v.invoices ?? {} };
}

/** Atomar lesen-ändern-schreiben (Zeilensperre), damit parallele Übertragungen keine Zuordnung verlieren. */
async function updateSetting<T>(key: string, fallback: () => T, fn: (v: T) => T) {
  await db.$transaction(async (tx) => {
    await tx.appSetting.upsert({ where: { key }, create: { key, value: fallback() as Prisma.InputJsonValue }, update: {} });
    await tx.$queryRaw`SELECT key FROM "AppSetting" WHERE key = ${key} FOR UPDATE`;
    const row = await tx.appSetting.findUniqueOrThrow({ where: { key } });
    const next = fn({ ...(fallback() as object), ...(row.value as object) } as T);
    await tx.appSetting.update({ where: { key }, data: { value: next as Prisma.InputJsonValue } });
  });
}

const patchMap = (ws: string, fn: (m: LexMap) => LexMap) => updateSetting<LexMap>(mapKey(ws), emptyMap, fn);

async function log(workspaceId: string, action: string, ok: boolean, detail: string) {
  await updateSetting<LexState>(stateKey(workspaceId), () => ({ enabled: false, log: [] }), (s) => ({
    ...s,
    log: [{ at: new Date().toISOString(), action, ok, detail: detail.slice(0, 300) }, ...(s.log ?? [])].slice(0, 30),
  }));
}

export async function setEnabled(workspaceId: string, enabled: boolean, actor: string) {
  await updateSetting<LexState>(stateKey(workspaceId), () => ({ enabled: false, log: [] }), (s) => ({ ...s, enabled, enabledBy: actor }));
  await audit({ workspaceId, actor, action: enabled ? "lexware.enabled" : "lexware.disabled" });
}

async function assertReady(workspaceId: string) {
  if (!lexwareConfigured()) throw new Error("LEXWARE_API_KEY ist nicht gesetzt.");
  if (!(await getState(workspaceId)).enabled) throw new Error("Lexware ist für diesen Sub-Account nicht aktiviert.");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Verbindung prüfen (nur lesend). */
export async function testConnection() {
  const p = await getProfile();
  return { companyName: p.companyName, organizationId: p.organizationId, taxType: p.taxType ?? null, smallBusiness: p.smallBusiness ?? null };
}

// ---------- Kontakte → Lexware ----------

async function upsertRemoteContact(existing: Ref | undefined, payload: ReturnType<typeof personToLexware>): Promise<Ref> {
  if (existing) {
    // Aktuelle Version holen (optimistische Sperre), dann aktualisieren
    const cur = await lexwareRequest<{ version: number }>("GET", `/v1/contacts/${existing.id}`);
    const res = await lexwareRequest<{ id: string; version: number }>("PUT", `/v1/contacts/${existing.id}`, { ...payload, version: cur.version });
    return { id: res.id, version: res.version };
  }
  const res = await lexwareRequest<{ id: string; version: number }>("POST", "/v1/contacts", payload);
  return { id: res.id, version: res.version };
}

/** Unternehmen (mit Hauptansprechpartner) übertragen bzw. aktualisieren. */
export async function pushCompany(workspaceId: string, companyId: string, actor: string): Promise<Ref> {
  await assertReady(workspaceId);
  const c = await db.company.findFirst({ where: { id: companyId, workspaceId } });
  if (!c) throw new Error("Unternehmen nicht gefunden.");
  const primary = await db.contact.findFirst({ where: { workspaceId, companyId }, orderBy: { createdAt: "asc" } });
  const map = await getMap(workspaceId);
  try {
    const ref = await upsertRemoteContact(map.companies[companyId], companyToLexware(c, primary));
    await patchMap(workspaceId, (m) => ({ ...m, companies: { ...m.companies, [companyId]: ref } }));
    await log(workspaceId, "Unternehmen übertragen", true, c.name);
    await audit({ workspaceId, actor, action: "lexware.company_pushed", target: companyId, detail: { lexwareId: ref.id } });
    return ref;
  } catch (e) {
    await log(workspaceId, "Unternehmen übertragen", false, `${c.name}: ${errText(e)}`);
    throw e;
  }
}

/** Kontakt übertragen: mit Unternehmen → Firmenkunde, sonst Personenkunde. Liefert die Lexware-Kontakt-ID. */
export async function pushContact(workspaceId: string, contactId: string, actor: string): Promise<Ref> {
  await assertReady(workspaceId);
  const p = await db.contact.findFirst({ where: { id: contactId, workspaceId } });
  if (!p) throw new Error("Kontakt nicht gefunden.");
  if (p.companyId) return pushCompany(workspaceId, p.companyId, actor);
  const map = await getMap(workspaceId);
  try {
    const ref = await upsertRemoteContact(map.contacts[contactId], personToLexware(p));
    await patchMap(workspaceId, (m) => ({ ...m, contacts: { ...m.contacts, [contactId]: ref } }));
    await log(workspaceId, "Kontakt übertragen", true, p.email ?? p.lastName ?? contactId);
    await audit({ workspaceId, actor, action: "lexware.contact_pushed", target: contactId, detail: { lexwareId: ref.id } });
    return ref;
  } catch (e) {
    await log(workspaceId, "Kontakt übertragen", false, `${p.email ?? contactId}: ${errText(e)}`);
    throw e;
  }
}

/** Alle Kunden übertragen: Kontakte mit Lifecycle „customer“ bzw. Unternehmen mit gewonnenen Deals oder Rechnungen. */
export async function pushCustomers(workspaceId: string, actor: string, limit = 200) {
  await assertReady(workspaceId);
  const contacts = await db.contact.findMany({
    where: { workspaceId, OR: [{ lifecycleStage: "customer" }, { invoices: { some: {} } }] },
    select: { id: true, companyId: true },
    take: limit,
  });
  const done = new Set<string>();
  let ok = 0;
  const errors: string[] = [];
  for (const c of contacts) {
    const key = c.companyId ? `co:${c.companyId}` : `ct:${c.id}`;
    if (done.has(key)) continue;
    done.add(key);
    try {
      await pushContact(workspaceId, c.id, actor);
      ok++;
    } catch (e) {
      errors.push(errText(e));
    }
  }
  return { total: done.size, ok, errors };
}

// ---------- Belege → Lexware ----------

/**
 * Angebot/Rechnung als Lexware-Beleg anlegen (Standard: Entwurf). Bereits übertragene Belege werden nicht doppelt
 * angelegt (Lexware erlaubt keine Änderung von Belegen per API).
 */
export async function pushInvoice(workspaceId: string, invoiceId: string, actor: string, opts: { finalize?: boolean } = {}) {
  await assertReady(workspaceId);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
  if (!inv) throw new Error("Beleg nicht gefunden.");
  if (inv.status === "CANCELLED") throw new Error("Stornierte Belege werden nicht übertragen.");
  const map = await getMap(workspaceId);
  if (map.invoices[invoiceId]) throw new Error("Dieser Beleg wurde bereits an Lexware übertragen.");

  let contactId: string | null = null;
  if (inv.contactId) contactId = (await pushContact(workspaceId, inv.contactId, actor)).id;

  const type: LexVoucherType = inv.kind === "QUOTE" ? "quotation" : inv.kind === "ORDER" ? "order-confirmation" : "invoice";
  // Auftragsbestätigung aus bereits übertragenem Angebot: Lexware verknüpft die Belegkette (precedingSalesVoucherId)
  const precedingId = inv.kind === "ORDER" && inv.fromQuoteId ? map.invoices[inv.fromQuoteId]?.id : undefined;
  const query = new URLSearchParams();
  if (opts.finalize) query.set("finalize", "true");
  if (precedingId) query.set("precedingSalesVoucherId", precedingId);
  const path = `/v1/${LEX_PATH[type]}${query.size ? `?${query}` : ""}`;
  try {
    const res = await lexwareRequest<{ id: string; version: number }>("POST", path, invoiceToLexware(inv, contactId));
    const ref: InvoiceRef = { id: res.id, version: res.version, type, pushedAt: new Date().toISOString(), finalized: !!opts.finalize, status: opts.finalize ? "open" : "draft" };
    await patchMap(workspaceId, (m) => ({ ...m, invoices: { ...m.invoices, [invoiceId]: ref } }));
    await log(workspaceId, type === "invoice" ? "Rechnung übertragen" : type === "quotation" ? "Angebot übertragen" : "Auftragsbestätigung übertragen", true, `${inv.number}${opts.finalize ? " (festgeschrieben)" : " (Entwurf)"}`);
    await audit({ workspaceId, actor, action: "lexware.invoice_pushed", target: invoiceId, detail: { lexwareId: res.id, type, finalize: !!opts.finalize } });
    if (inv.contactId) {
      await db.activity.create({
        data: { workspaceId, contactId: inv.contactId, type: "SYSTEM", body: `${inv.number} an Lexware übertragen (${opts.finalize ? "festgeschrieben" : "Entwurf"})`, meta: { lexwareId: res.id } },
      });
    }
    return { ...ref, link: lexwareDeeplink(type, res.id, opts.finalize ? "view" : "edit") };
  } catch (e) {
    await log(workspaceId, "Beleg übertragen", false, `${inv.number}: ${errText(e)}`);
    throw e;
  }
}

/** Status übertragener Belege aus Lexware lesen; bezahlt → PAID, storniert → CANCELLED, angenommen → ACCEPTED. */
export async function pullStatuses(workspaceId: string, actor = "system") {
  await assertReady(workspaceId);
  const map = await getMap(workspaceId);
  let checked = 0;
  let changed = 0;
  const errors: string[] = [];
  for (const [invoiceId, ref] of Object.entries(map.invoices)) {
    if (ref.status === "paid" || ref.status === "paidoff" || ref.status === "voided") continue;
    try {
      const v = await lexwareRequest<{ voucherStatus?: string; voucherNumber?: string; version: number }>("GET", `/v1/${LEX_PATH[ref.type] ?? "invoices"}/${ref.id}`);
      checked++;
      await patchMap(workspaceId, (m) => ({ ...m, invoices: { ...m.invoices, [invoiceId]: { ...m.invoices[invoiceId], status: v.voucherStatus, voucherNumber: v.voucherNumber, version: v.version } } }));
      const inv = await db.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
      const next = inv ? mapVoucherStatus(inv.kind, v.voucherStatus) : null;
      if (inv && next && inv.status !== next && inv.status !== "CANCELLED") {
        await db.$transaction(async (tx) => {
          const r = await tx.invoice.updateMany({ where: { id: inv.id, status: inv.status }, data: { status: next } });
          if (r.count && next === "PAID") await emitInvoicePaid(tx, inv, { via: "lexware" });
        });
        await audit({ workspaceId, actor, action: "lexware.status_synced", target: inv.id, detail: { from: inv.status, to: next } });
        changed++;
      }
    } catch (e) {
      if (e instanceof LexwareError && e.status === 404) {
        errors.push(`${invoiceId}: in Lexware gelöscht`);
        continue;
      }
      errors.push(errText(e));
    }
  }
  await updateSetting<LexState>(stateKey(workspaceId), () => ({ enabled: false, log: [] }), (s) => ({ ...s, lastSync: new Date().toISOString() }));
  await log(workspaceId, "Status abgeglichen", errors.length === 0, `${checked} geprüft, ${changed} geändert${errors.length ? `, ${errors.length} Fehler` : ""}`);
  return { checked, changed, errors };
}

// ---------- Rückweg: Lexware → CRM ----------

/** Kunden aus Lexware importieren (Abgleich per E-Mail bzw. Firmenname). Import löst keine Prozesse aus. */
export async function importContacts(workspaceId: string, actor: string, maxPages = 20) {
  await assertReady(workspaceId);
  let created = 0;
  let linked = 0;
  let skipped = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await lexwareRequest<{ content: LexwareContact[]; totalPages: number }>("GET", `/v1/contacts?customer=true&page=${page}&size=100`);
    for (const lc of res.content ?? []) {
      if (lc.archived) {
        skipped++;
        continue;
      }
      const local = lexwareToLocal(lc);
      let companyId: string | null = null;
      if (local.kind === "company" && local.companyName) {
        const existing = await db.company.findFirst({ where: { workspaceId, name: { equals: local.companyName, mode: "insensitive" } } });
        const co = existing ?? (await db.company.create({ data: { workspaceId, name: local.companyName.slice(0, 200), phone: local.phone, address: local.address, externalRef: `lexware:${lc.id}` } }));
        if (!existing) {
          created++;
          await emitEvent({ workspaceId, type: "company.created", objectType: "company", objectId: co.id, data: { import: true, source: "lexware" } });
        } else linked++;
        companyId = co.id;
        await patchMap(workspaceId, (m) => ({ ...m, companies: { ...m.companies, [co.id]: { id: lc.id, version: lc.version } } }));
      }
      const ct = local.contact;
      if (!ct?.email) {
        if (local.kind === "person") skipped++;
        continue;
      }
      const existing = await db.contact.findUnique({ where: { workspaceId_email: { workspaceId, email: ct.email } } });
      if (existing) {
        linked++;
        if (!existing.companyId && companyId) await db.contact.update({ where: { id: existing.id }, data: { companyId } });
        if (local.kind === "person") await patchMap(workspaceId, (m) => ({ ...m, contacts: { ...m.contacts, [existing.id]: { id: lc.id, version: lc.version } } }));
        continue;
      }
      const c = await db.contact.create({
        data: {
          workspaceId, email: ct.email, firstName: ct.firstName, lastName: ct.lastName, phone: ct.phone,
          company: local.companyName, companyId, lifecycleStage: "customer", source: "Lexware-Import", tags: ["lexware-import"],
          externalRef: `lexware:${lc.id}`,
        },
      });
      created++;
      await emitEvent({ workspaceId, type: "contact.created", objectType: "contact", objectId: c.id, data: { import: true, source: "lexware" } });
      if (local.kind === "person") await patchMap(workspaceId, (m) => ({ ...m, contacts: { ...m.contacts, [c.id]: { id: lc.id, version: lc.version } } }));
    }
    if (page + 1 >= (res.totalPages ?? 1)) break;
  }
  await log(workspaceId, "Kontakte importiert", true, `${created} neu, ${linked} zugeordnet, ${skipped} übersprungen`);
  await audit({ workspaceId, actor, action: "lexware.contacts_imported", detail: { created, linked, skipped } });
  return { created, linked, skipped };
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvent } from "../events";
import { audit } from "../audit";
import { emailDomain, isFreemail, nameFromDomain, normalizeDomain } from "./domain";

type Tx = Prisma.TransactionClient;

/** Unternehmen anlegen (Domain normalisiert) inkl. Ereignis company.created – in einer Transaktion. */
export async function createCompany(workspaceId: string, input: { name: string; domain?: string | null; industry?: string | null; ownerId?: string | null; source?: string }, tx?: Tx) {
  const run = async (t: Tx) => {
    const domain = normalizeDomain(input.domain ?? null);
    const c = await t.company.create({ data: { workspaceId, name: input.name.trim().slice(0, 200), domain, industry: input.industry ?? null, ownerId: input.ownerId ?? null } });
    await emitEvent({ workspaceId, type: "company.created", objectType: "company", objectId: c.id, data: { source: input.source ?? "manual" } }, t);
    return c;
  };
  return tx ? run(tx) : db.$transaction(run);
}

/**
 * Ordnet einen Kontakt anhand seiner E-Mail-Domain einem Unternehmen zu (Freemail ausgenommen).
 * Legt das Unternehmen optional an. Bestehende Zuordnung bleibt unangetastet.
 */
export async function associateByDomain(contactId: string, opts: { createIfMissing?: boolean; ignoreFreemail?: boolean } = {}) {
  const { createIfMissing = true, ignoreFreemail = true } = opts;
  const c = await db.contact.findUnique({ where: { id: contactId }, select: { id: true, workspaceId: true, email: true, companyId: true, company: true } });
  if (!c || c.companyId) return { status: "unchanged" as const, companyId: c?.companyId ?? null };
  const domain = emailDomain(c.email);
  if (!domain) return { status: "no_domain" as const, companyId: null };
  if (ignoreFreemail && isFreemail(domain)) return { status: "freemail" as const, companyId: null };

  return db.$transaction(async (tx) => {
    let company = await tx.company.findUnique({ where: { workspaceId_domain: { workspaceId: c.workspaceId, domain } } });
    let created = false;
    if (!company) {
      if (!createIfMissing) return { status: "not_found" as const, companyId: null };
      company = await createCompany(c.workspaceId, { name: c.company?.trim() || nameFromDomain(domain), domain, source: "domain-match" }, tx);
      created = true;
    }
    await tx.contact.update({ where: { id: c.id }, data: { companyId: company.id } });
    await emitEvent({ workspaceId: c.workspaceId, type: "contact.property_changed", objectType: "contact", objectId: c.id, data: { field: "companyId", from: null, to: company.id } }, tx);
    return { status: created ? ("created" as const) : ("linked" as const), companyId: company.id };
  });
}

/** Führt `dropId` in `keepId` zusammen: Kontakte, Deals, Tickets umhängen, Lücken füllen, Dublette löschen. */
export async function mergeCompanies(workspaceId: string, keepId: string, dropId: string, actor: string) {
  if (keepId === dropId) throw new Error("Bitte zwei verschiedene Unternehmen wählen.");
  await db.$transaction(async (tx) => {
    const [keep, drop] = await Promise.all([
      tx.company.findFirst({ where: { id: keepId, workspaceId } }),
      tx.company.findFirst({ where: { id: dropId, workspaceId } }),
    ]);
    if (!keep || !drop) throw new Error("Unternehmen nicht gefunden.");
    await tx.contact.updateMany({ where: { workspaceId, companyId: drop.id }, data: { companyId: keep.id } });
    await tx.deal.updateMany({ where: { workspaceId, companyId: drop.id }, data: { companyId: keep.id } });
    await tx.ticket.updateMany({ where: { workspaceId, companyId: drop.id }, data: { companyId: keep.id } });
    const fill = <T,>(a: T | null, b: T | null) => a ?? b;
    const attrs = { ...((drop.attributes as Record<string, unknown>) ?? {}), ...((keep.attributes as Record<string, unknown>) ?? {}) };
    // Domain der Dublette erst freigeben (unique), dann ggf. übernehmen
    await tx.company.delete({ where: { id: drop.id } });
    await tx.company.update({
      where: { id: keep.id },
      data: {
        domain: fill(keep.domain, drop.domain),
        industry: fill(keep.industry, drop.industry),
        size: fill(keep.size, drop.size),
        phone: fill(keep.phone, drop.phone),
        address: fill(keep.address, drop.address),
        website: fill(keep.website, drop.website),
        ownerId: fill(keep.ownerId, drop.ownerId),
        lifecycleStage: fill(keep.lifecycleStage, drop.lifecycleStage),
        attributes: attrs as Prisma.InputJsonObject,
      },
    });
  });
  await audit({ workspaceId, actor, action: "company.merged", target: keepId, detail: { merged: dropId } });
}

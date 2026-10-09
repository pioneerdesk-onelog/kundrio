import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { emitEvent, emitEvents, type EventInput } from "../events";
import { requestApproval } from "../approvals";
import {
  DATA_NOTE, McpToolError, approvalLink, assertAttributes, assertCompany, assertLifecycle, assertOwner, canDo, contactView, findContact,
  idArg, lifecycleKeys, limitArg, need, normalizeDomain, offsetArg, ownerScope, tool,
} from "./context";

// Admin-MCP: Werkzeuge für Kontakte, Unternehmen, Deals, Tickets, Aufgaben, Listen, Analytics.

const attrsArg = z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional();
const tagsArg = z.array(z.string().trim().min(1).max(60)).max(30);

const contactSelectFields = {
  id: true, email: true, firstName: true, lastName: true, phone: true, company: true, companyId: true, lifecycleStage: true, ownerId: true,
  tags: true, attributes: true, trustScore: true, consentEmailAt: true, unsubscribedAt: true, source: true, createdAt: true, updatedAt: true,
} as const;

function mergeAttrs(prev: unknown, next: Record<string, unknown> | undefined) {
  const base = prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  if (!next) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(next)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

async function dealStage(workspaceId: string, stageId: string) {
  const s = await db.stage.findFirst({ where: { id: stageId, pipeline: { workspaceId, objectType: "deal" } } });
  if (!s) throw new McpToolError("Deal-Phase nicht gefunden (siehe list_pipelines mit objectType deal).");
  return s;
}

async function ticketStage(workspaceId: string, stageId?: string) {
  if (stageId) {
    const s = await db.stage.findFirst({ where: { id: stageId, pipeline: { workspaceId, objectType: "ticket" } } });
    if (!s) throw new McpToolError("Ticket-Status nicht gefunden (siehe list_pipelines mit objectType ticket).");
    return s;
  }
  const p = await db.pipeline.findFirst({
    where: { workspaceId, objectType: "ticket" },
    orderBy: { createdAt: "asc" },
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!p?.stages[0]) throw new McpToolError("Für diesen Sub-Account gibt es noch keine Ticket-Pipeline.");
  return p.stages[0];
}

export const crmTools = [
  // ---------------- Lesen ----------------
  tool({
    name: "search_contacts",
    title: "Kontakte suchen",
    description: "Sucht Kontakte nach Name, E-Mail oder Firma und filtert optional nach Lifecycle-Phase, Tag, Liste oder zuständiger Person." + DATA_NOTE,
    access: "read",
    perm: { object: "contacts", action: "read" },
    input: z.object({
      query: z.string().trim().max(200).optional(),
      lifecycleStage: z.string().max(40).optional(),
      tag: z.string().max(60).optional(),
      listId: z.string().max(60).optional(),
      ownerId: z.string().max(60).optional(),
      limit: limitArg,
      offset: offsetArg,
    }),
    run: async (a, ctx) => {
      const q = a.query?.trim();
      const where: Prisma.ContactWhereInput = {
        workspaceId: ctx.workspaceId,
        AND: [ownerScope(ctx, "contacts") as Prisma.ContactWhereInput],
        ...(a.lifecycleStage ? { lifecycleStage: a.lifecycleStage } : {}),
        ...(a.tag ? { tags: { has: a.tag } } : {}),
        ...(a.ownerId ? { ownerId: a.ownerId } : {}),
        ...(a.listId ? { listMemberships: { some: { listId: a.listId } } } : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { company: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        db.contact.count({ where }),
        db.contact.findMany({ where, orderBy: { updatedAt: "desc" }, take: a.limit, skip: a.offset, select: contactSelectFields }),
      ]);
      return { total, offset: a.offset, contacts: rows.map(contactView) };
    },
  }),
  tool({
    name: "get_contact",
    title: "Kontakt abrufen",
    description: "Liefert einen Kontakt (per ID oder E-Mail) mit Unternehmen, Listen, offenen Deals/Tickets und Aufgaben." + DATA_NOTE,
    access: "read",
    perm: { object: "contacts", action: "read" },
    input: z.object({ contact: z.string().trim().min(1).max(200).describe("Kontakt-ID oder E-Mail-Adresse") }),
    run: async (a, ctx) => {
      const c = await findContact(ctx.workspaceId, a.contact);
      need(ctx, "contacts", "read", c.ownerId);
      const [company, lists, deals, tickets, tasks] = await Promise.all([
        c.companyId && canDo(ctx, "companies", "read") ? db.company.findUnique({ where: { id: c.companyId }, select: { id: true, name: true, domain: true } }) : null,
        canDo(ctx, "lists", "read") ? db.contactListMember.findMany({ where: { contactId: c.id }, include: { list: { select: { id: true, numericId: true, name: true } } } }) : [],
        db.deal.findMany({ where: { workspaceId: ctx.workspaceId, contactId: c.id, AND: [ownerScope(ctx, "deals") as Prisma.DealWhereInput] }, include: { stage: { select: { name: true, kind: true } } }, take: 20 }),
        db.ticket.findMany({ where: { workspaceId: ctx.workspaceId, contactId: c.id, AND: [ownerScope(ctx, "tickets") as Prisma.TicketWhereInput] }, include: { stage: { select: { name: true, kind: true } } }, take: 20 }),
        db.task.findMany({ where: { workspaceId: ctx.workspaceId, contactId: c.id, doneAt: null, AND: [ownerScope(ctx, "tasks") as Prisma.TaskWhereInput] }, take: 20, orderBy: { dueAt: "asc" } }),
      ]);
      return {
        contact: contactView(c),
        company,
        lists: lists.map((l) => l.list),
        deals: deals.map((d) => ({ id: d.id, title: d.title, valueCents: d.valueCents, stage: d.stage.name, stageKind: d.stage.kind })),
        tickets: tickets.map((t) => ({ id: t.id, number: t.numericId, subject: t.subject, priority: t.priority, status: t.stage.name })),
        openTasks: tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt })),
      };
    },
  }),
  tool({
    name: "get_activity_timeline",
    title: "Zeitleiste eines Kontakts",
    description: "Liefert die letzten Aktivitäten (Notizen, E-Mails, Formulare, Deals, Systemereignisse) eines Kontakts." + DATA_NOTE,
    access: "read",
    perm: { object: "contacts", action: "read" },
    input: z.object({ contact: z.string().trim().min(1).max(200), limit: limitArg }),
    run: async (a, ctx) => {
      const c = await findContact(ctx.workspaceId, a.contact);
      need(ctx, "contacts", "read", c.ownerId);
      const acts = await db.activity.findMany({ where: { workspaceId: ctx.workspaceId, contactId: c.id }, orderBy: { createdAt: "desc" }, take: a.limit });
      return { contactId: c.id, activities: acts.map((x) => ({ id: x.id, type: x.type, body: x.body, at: x.createdAt })) };
    },
  }),
  tool({
    name: "search_companies",
    title: "Unternehmen suchen",
    description: "Sucht Unternehmen nach Name oder Domain." + DATA_NOTE,
    access: "read",
    perm: { object: "companies", action: "read" },
    input: z.object({ query: z.string().trim().max(200).optional(), limit: limitArg, offset: offsetArg }),
    run: async (a, ctx) => {
      const q = a.query?.trim();
      const where: Prisma.CompanyWhereInput = {
        workspaceId: ctx.workspaceId,
        AND: [ownerScope(ctx, "companies") as Prisma.CompanyWhereInput],
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q.toLowerCase() } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        db.company.count({ where }),
        db.company.findMany({ where, orderBy: { name: "asc" }, take: a.limit, skip: a.offset, include: { _count: { select: { contacts: true, deals: true } } } }),
      ]);
      return {
        total,
        companies: rows.map((c) => ({
          id: c.id, name: c.name, domain: c.domain, industry: c.industry, size: c.size, lifecycleStage: c.lifecycleStage, ownerId: c.ownerId,
          contacts: c._count.contacts, deals: c._count.deals,
        })),
      };
    },
  }),
  tool({
    name: "get_company",
    title: "Unternehmen abrufen",
    description: "Liefert ein Unternehmen mit zugeordneten Kontakten, Deals und Tickets." + DATA_NOTE,
    access: "read",
    perm: { object: "companies", action: "read" },
    input: z.object({ companyId: idArg }),
    run: async (a, ctx) => {
      const c = await db.company.findFirst({
        where: { id: a.companyId, workspaceId: ctx.workspaceId },
        include: {
          contacts: { where: { AND: [ownerScope(ctx, "contacts") as Prisma.ContactWhereInput] }, take: 50, select: { id: true, email: true, firstName: true, lastName: true, lifecycleStage: true } },
          deals: { where: { AND: [ownerScope(ctx, "deals") as Prisma.DealWhereInput] }, take: 50, include: { stage: { select: { name: true, kind: true } } } },
          tickets: { where: { AND: [ownerScope(ctx, "tickets") as Prisma.TicketWhereInput] }, take: 50, include: { stage: { select: { name: true } } } },
        },
      });
      if (!c) throw new McpToolError("Unternehmen nicht gefunden.");
      need(ctx, "companies", "read", c.ownerId);
      return {
        company: {
          id: c.id, name: c.name, domain: c.domain, industry: c.industry, size: c.size, phone: c.phone, address: c.address, website: c.website,
          lifecycleStage: c.lifecycleStage, ownerId: c.ownerId, attributes: c.attributes,
        },
        contacts: c.contacts,
        deals: c.deals.map((d) => ({ id: d.id, title: d.title, valueCents: d.valueCents, stage: d.stage.name, stageKind: d.stage.kind })),
        tickets: c.tickets.map((t) => ({ id: t.id, number: t.numericId, subject: t.subject, status: t.stage.name })),
      };
    },
  }),
  tool({
    name: "list_deals",
    title: "Deals auflisten",
    description: "Listet Deals, optional nach Phase, Phasenart (OPEN/WON/LOST), Kontakt, Unternehmen oder zuständiger Person." + DATA_NOTE,
    access: "read",
    perm: { object: "deals", action: "read" },
    input: z.object({
      stageId: z.string().max(60).optional(),
      stageKind: z.enum(["OPEN", "WON", "LOST"]).optional(),
      contactId: z.string().max(60).optional(),
      companyId: z.string().max(60).optional(),
      ownerId: z.string().max(60).optional(),
      limit: limitArg,
      offset: offsetArg,
    }),
    run: async (a, ctx) => {
      const where: Prisma.DealWhereInput = {
        workspaceId: ctx.workspaceId,
        AND: [ownerScope(ctx, "deals") as Prisma.DealWhereInput],
        ...(a.stageId ? { stageId: a.stageId } : {}),
        ...(a.stageKind ? { stage: { kind: a.stageKind } } : {}),
        ...(a.contactId ? { contactId: a.contactId } : {}),
        ...(a.companyId ? { companyId: a.companyId } : {}),
        ...(a.ownerId ? { ownerId: a.ownerId } : {}),
      };
      const [total, rows] = await Promise.all([
        db.deal.count({ where }),
        db.deal.findMany({ where, orderBy: { updatedAt: "desc" }, take: a.limit, skip: a.offset, include: { stage: { select: { name: true, kind: true } } } }),
      ]);
      return {
        total,
        deals: rows.map((d) => ({
          id: d.id, title: d.title, valueCents: d.valueCents, currency: d.currency, stageId: d.stageId, stage: d.stage.name, stageKind: d.stage.kind,
          contactId: d.contactId, companyId: d.companyId, ownerId: d.ownerId, closedAt: d.closedAt, updatedAt: d.updatedAt,
        })),
      };
    },
  }),
  tool({
    name: "get_deal",
    title: "Deal abrufen",
    description: "Liefert einen Deal mit Phase, Kontakt, Unternehmen und offenen Aufgaben." + DATA_NOTE,
    access: "read",
    perm: { object: "deals", action: "read" },
    input: z.object({ dealId: idArg }),
    run: async (a, ctx) => {
      const d = await db.deal.findFirst({
        where: { id: a.dealId, workspaceId: ctx.workspaceId },
        include: {
          stage: true,
          pipeline: { select: { id: true, name: true } },
          contact: { select: contactSelectFields },
          company: { select: { id: true, name: true, domain: true } },
          tasks: { where: { doneAt: null }, take: 20 },
        },
      });
      if (!d) throw new McpToolError("Deal nicht gefunden.");
      need(ctx, "deals", "read", d.ownerId);
      return {
        deal: { id: d.id, title: d.title, valueCents: d.valueCents, currency: d.currency, lostReason: d.lostReason, closedAt: d.closedAt, ownerId: d.ownerId },
        pipeline: d.pipeline,
        stage: { id: d.stage.id, name: d.stage.name, kind: d.stage.kind },
        contact: d.contact && canDo(ctx, "contacts", "read", d.contact.ownerId) ? contactView(d.contact) : null,
        company: canDo(ctx, "companies", "read") ? d.company : null,
        openTasks: d.tasks.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt })),
      };
    },
  }),
  tool({
    name: "list_tickets",
    title: "Tickets auflisten",
    description: "Listet Service-Tickets, optional nach Status, Priorität, Kontakt, Unternehmen oder zuständiger Person." + DATA_NOTE,
    access: "read",
    perm: { object: "tickets", action: "read" },
    input: z.object({
      stageId: z.string().max(60).optional(),
      open: z.boolean().optional().describe("true = nur offene, false = nur geschlossene"),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      contactId: z.string().max(60).optional(),
      companyId: z.string().max(60).optional(),
      ownerId: z.string().max(60).optional(),
      limit: limitArg,
      offset: offsetArg,
    }),
    run: async (a, ctx) => {
      const where: Prisma.TicketWhereInput = {
        workspaceId: ctx.workspaceId,
        AND: [ownerScope(ctx, "tickets") as Prisma.TicketWhereInput],
        ...(a.stageId ? { stageId: a.stageId } : {}),
        ...(a.open === true ? { closedAt: null } : a.open === false ? { closedAt: { not: null } } : {}),
        ...(a.priority ? { priority: a.priority } : {}),
        ...(a.contactId ? { contactId: a.contactId } : {}),
        ...(a.companyId ? { companyId: a.companyId } : {}),
        ...(a.ownerId ? { ownerId: a.ownerId } : {}),
      };
      const [total, rows] = await Promise.all([
        db.ticket.count({ where }),
        db.ticket.findMany({ where, orderBy: { updatedAt: "desc" }, take: a.limit, skip: a.offset, include: { stage: { select: { name: true, kind: true } } } }),
      ]);
      return {
        total,
        tickets: rows.map((t) => ({
          id: t.id, number: t.numericId, subject: t.subject, priority: t.priority, source: t.source, stageId: t.stageId, status: t.stage.name,
          contactId: t.contactId, companyId: t.companyId, ownerId: t.ownerId, slaDueAt: t.slaDueAt, closedAt: t.closedAt, createdAt: t.createdAt,
        })),
      };
    },
  }),
  tool({
    name: "get_ticket",
    title: "Ticket abrufen",
    description: "Liefert ein Ticket (per ID oder Ticketnummer) mit Beschreibung, Status, Kontakt und Unternehmen." + DATA_NOTE,
    access: "read",
    perm: { object: "tickets", action: "read" },
    input: z.object({ ticket: z.union([idArg, z.number().int().positive()]).describe("Ticket-ID oder Ticketnummer") }),
    run: async (a, ctx) => {
      const t = await db.ticket.findFirst({
        where: { workspaceId: ctx.workspaceId, ...(typeof a.ticket === "number" ? { numericId: a.ticket } : { id: a.ticket }) },
        include: { stage: true, contact: { select: contactSelectFields }, company: { select: { id: true, name: true, domain: true } } },
      });
      if (!t) throw new McpToolError("Ticket nicht gefunden.");
      need(ctx, "tickets", "read", t.ownerId);
      return {
        ticket: {
          id: t.id, number: t.numericId, subject: t.subject, description: t.description, priority: t.priority, source: t.source, ownerId: t.ownerId,
          slaDueAt: t.slaDueAt, firstResponseAt: t.firstResponseAt, closedAt: t.closedAt, attributes: t.attributes, createdAt: t.createdAt,
        },
        status: { id: t.stage.id, name: t.stage.name, kind: t.stage.kind },
        contact: t.contact && canDo(ctx, "contacts", "read", t.contact.ownerId) ? contactView(t.contact) : null,
        company: canDo(ctx, "companies", "read") ? t.company : null,
      };
    },
  }),
  tool({
    name: "list_pipelines",
    title: "Pipelines und Phasen",
    description: "Listet Deal- und Ticket-Pipelines mit ihren Phasen (IDs für create_deal, move_deal_stage, create_ticket, update_ticket).",
    access: "read",
    perm: { anyOf: ["deals", "tickets"], action: "read" },
    input: z.object({ objectType: z.enum(["deal", "ticket"]).optional() }),
    run: async (a, ctx) => {
      const rows = await db.pipeline.findMany({
        where: { workspaceId: ctx.workspaceId, ...(a.objectType ? { objectType: a.objectType } : {}) },
        orderBy: { createdAt: "asc" },
        include: { stages: { orderBy: { position: "asc" } } },
      });
      return {
        pipelines: rows.map((p) => ({
          id: p.id, name: p.name, objectType: p.objectType,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position })),
        })),
      };
    },
  }),
  tool({
    name: "list_lifecycle_stages",
    title: "Lifecycle-Phasen",
    description: "Listet die Lifecycle-Phasen dieses Sub-Accounts (Schlüssel für update_contact und Prozess-Knoten action.set_lifecycle).",
    access: "read",
    perm: null,
    input: z.object({}),
    run: async (_a, ctx) => {
      const rows = await db.lifecycleStage.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { position: "asc" } });
      if (rows.length) return { stages: rows.map((r) => ({ key: r.key, label: r.label, position: r.position })) };
      return { stages: (await lifecycleKeys(ctx.workspaceId)).map((key, position) => ({ key, label: key, position })), note: "Standardphasen (noch nicht angepasst)." };
    },
  }),
  tool({
    name: "list_properties",
    title: "Eigene Felder",
    description: "Listet die eigenen Felder (Eigenschaften) für Kontakte, Unternehmen und Deals mit Typ und Optionen.",
    access: "read",
    perm: null,
    input: z.object({ objectType: z.enum(["contact", "company", "deal"]).optional() }),
    run: async (a, ctx) => {
      const rows = await db.propertyDefinition.findMany({
        where: { workspaceId: ctx.workspaceId, ...(a.objectType ? { objectType: a.objectType } : {}) },
        orderBy: [{ objectType: "asc" }, { label: "asc" }],
      });
      return { properties: rows.map((p) => ({ objectType: p.objectType, key: p.key, label: p.label, type: p.type, options: p.options })) };
    },
  }),
  tool({
    name: "list_lists",
    title: "Listen",
    description: "Listet die Kontaktlisten mit ID, numerischer ID und Mitgliederzahl.",
    access: "read",
    perm: { object: "lists", action: "read" },
    input: z.object({}),
    run: async (_a, ctx) => {
      const rows = await db.contactList.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } });
      return { lists: rows.map((l) => ({ id: l.id, numericId: l.numericId, name: l.name, kind: l.kind, members: l._count.members })) };
    },
  }),
  tool({
    name: "analytics_summary",
    title: "Kennzahlen",
    description: "Kennzahlen der letzten N Tage (Standard 30): neue Kontakte, Seitenaufrufe, KI-Bot-Besuche, Besucher aus KI-Antworten, Conversions, Pipeline und gewonnene Deals, offene Tickets.",
    access: "read",
    perm: { object: "analytics", action: "read" },
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    run: async (a, ctx) => {
      const since = new Date(Date.now() - a.days * 864e5);
      const w = ctx.workspaceId;
      const [newContacts, pageviews, aiBots, aiHumans, conversions, openDeals, wonDeals, openTickets, lifecycle] = await Promise.all([
        db.contact.count({ where: { workspaceId: w, createdAt: { gte: since } } }),
        db.analyticsEvent.count({ where: { workspaceId: w, kind: "pageview", ts: { gte: since } } }),
        db.analyticsEvent.groupBy({ by: ["botName"], where: { workspaceId: w, kind: "bot", botCategory: { in: ["ai_training", "ai_search", "ai_user"] }, ts: { gte: since } }, _count: true }),
        db.analyticsEvent.groupBy({ by: ["aiReferrer"], where: { workspaceId: w, kind: "pageview", aiReferrer: { not: null }, ts: { gte: since } }, _count: true }),
        db.analyticsEvent.count({ where: { workspaceId: w, kind: "conversion", ts: { gte: since } } }),
        db.deal.aggregate({ where: { workspaceId: w, stage: { kind: "OPEN" } }, _sum: { valueCents: true }, _count: true }),
        db.deal.aggregate({ where: { workspaceId: w, stage: { kind: "WON" }, closedAt: { gte: since } }, _sum: { valueCents: true }, _count: true }),
        db.ticket.count({ where: { workspaceId: w, closedAt: null } }),
        db.contact.groupBy({ by: ["lifecycleStage"], where: { workspaceId: w }, _count: true }),
      ]);
      return {
        days: a.days,
        newContacts,
        pageviews,
        aiBotVisits: aiBots.reduce((s, r) => s + r._count, 0),
        aiBotsByName: Object.fromEntries(aiBots.map((r) => [r.botName ?? "unbekannt", r._count])),
        visitorsFromAi: aiHumans.reduce((s, r) => s + r._count, 0),
        visitorsFromAiBySource: Object.fromEntries(aiHumans.map((r) => [r.aiReferrer ?? "unbekannt", r._count])),
        conversions,
        openPipelineCents: openDeals._sum.valueCents ?? 0,
        openDeals: openDeals._count,
        wonCents: wonDeals._sum.valueCents ?? 0,
        wonDeals: wonDeals._count,
        openTickets,
        contactsByLifecycle: Object.fromEntries(lifecycle.map((r) => [r.lifecycleStage, r._count])),
      };
    },
  }),

  // ---------------- Schreiben (ohne Außenwirkung) ----------------
  tool({
    name: "create_contact",
    title: "Kontakt anlegen",
    description:
      "Legt einen Kontakt an. Es wird KEINE E-Mail-Einwilligung gesetzt (die entsteht nur per Double-Opt-in). Existiert die E-Mail bereits, wird ein Fehler mit der vorhandenen ID geliefert.",
    access: "write",
    perm: { object: "contacts", action: "edit" },
    input: z.object({
      email: z.email().max(200).optional(),
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
      phone: z.string().trim().max(40).optional(),
      companyName: z.string().trim().max(200).optional(),
      companyId: z.string().max(60).optional(),
      lifecycleStage: z.string().max(40).optional(),
      ownerId: z.string().max(60).optional(),
      tags: tagsArg.optional(),
      attributes: attrsArg,
    }),
    run: async (a, ctx) => {
      if (!a.email && !a.firstName && !a.lastName) throw new McpToolError("Mindestens E-Mail oder Name angeben.");
      const email = a.email?.toLowerCase();
      if (email) {
        const dup = await db.contact.findFirst({ where: { workspaceId: ctx.workspaceId, email }, select: { id: true } });
        if (dup) throw new McpToolError(`Kontakt mit dieser E-Mail existiert bereits (id ${dup.id}). Nutze update_contact.`);
      }
      if (a.lifecycleStage) await assertLifecycle(ctx.workspaceId, a.lifecycleStage);
      await assertOwner(ctx.workspaceId, a.ownerId);
      if (a.ownerId) need(ctx, "contacts", "edit", a.ownerId);
      await assertCompany(ctx.workspaceId, a.companyId);
      await assertAttributes(ctx.workspaceId, "contact", a.attributes);
      const c = await db.$transaction(async (tx) => {
        const created = await tx.contact.create({
          data: {
            workspaceId: ctx.workspaceId,
            email: email ?? null,
            firstName: a.firstName,
            lastName: a.lastName,
            phone: a.phone,
            company: a.companyName,
            companyId: a.companyId,
            lifecycleStage: a.lifecycleStage ?? "lead",
            ownerId: a.ownerId,
            tags: a.tags ?? [],
            attributes: mergeAttrs({}, a.attributes) as Prisma.InputJsonValue,
            source: "mcp",
          },
        });
        await tx.activity.create({ data: { workspaceId: ctx.workspaceId, contactId: created.id, type: "SYSTEM", body: "Kontakt über MCP angelegt" } });
        await emitEvent({ workspaceId: ctx.workspaceId, type: "contact.created", objectType: "contact", objectId: created.id, data: { source: "mcp" } }, tx);
        for (const tag of created.tags) await emitEvent({ workspaceId: ctx.workspaceId, type: "contact.tag_added", objectType: "contact", objectId: created.id, data: { tag } }, tx);
        return created;
      });
      return { created: true, contact: contactView(c) };
    },
  }),
  tool({
    name: "update_contact",
    title: "Kontakt ändern",
    description:
      "Ändert Stammdaten, Lifecycle-Phase, zuständige Person, Unternehmen, Tags (setzen/hinzufügen/entfernen) oder eigene Felder (null löscht ein Feld). E-Mail-Einwilligungen lassen sich hier NICHT setzen.",
    access: "write",
    perm: { object: "contacts", action: "edit" },
    idempotent: true,
    input: z.object({
      contact: z.string().trim().min(1).max(200).describe("Kontakt-ID oder E-Mail"),
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
      phone: z.string().trim().max(40).optional(),
      companyName: z.string().trim().max(200).optional(),
      companyId: z.string().max(60).nullable().optional(),
      lifecycleStage: z.string().max(40).optional(),
      ownerId: z.string().max(60).nullable().optional(),
      addTags: tagsArg.optional(),
      removeTags: tagsArg.optional(),
      attributes: attrsArg,
    }),
    run: async (a, ctx) => {
      const c = await findContact(ctx.workspaceId, a.contact);
      need(ctx, "contacts", "edit", c.ownerId);
      if (a.ownerId !== undefined) need(ctx, "contacts", "edit", a.ownerId);
      if (a.lifecycleStage) await assertLifecycle(ctx.workspaceId, a.lifecycleStage);
      if (a.ownerId) await assertOwner(ctx.workspaceId, a.ownerId);
      if (a.companyId) await assertCompany(ctx.workspaceId, a.companyId);
      await assertAttributes(ctx.workspaceId, "contact", a.attributes);
      const tags = [...new Set([...c.tags.filter((t) => !(a.removeTags ?? []).includes(t)), ...(a.addTags ?? [])])];
      const added = tags.filter((t) => !c.tags.includes(t));
      const data: Prisma.ContactUncheckedUpdateInput = {
        ...(a.firstName !== undefined ? { firstName: a.firstName } : {}),
        ...(a.lastName !== undefined ? { lastName: a.lastName } : {}),
        ...(a.phone !== undefined ? { phone: a.phone } : {}),
        ...(a.companyName !== undefined ? { company: a.companyName } : {}),
        ...(a.companyId !== undefined ? { companyId: a.companyId } : {}),
        ...(a.lifecycleStage ? { lifecycleStage: a.lifecycleStage } : {}),
        ...(a.ownerId !== undefined ? { ownerId: a.ownerId } : {}),
        ...(a.addTags || a.removeTags ? { tags } : {}),
        ...(a.attributes ? { attributes: mergeAttrs(c.attributes, a.attributes) as Prisma.InputJsonValue } : {}),
      };
      const changed = Object.keys(data);
      if (changed.length === 0) throw new McpToolError("Keine Änderung angegeben.");
      const updated = await db.$transaction(async (tx) => {
        const u = await tx.contact.update({ where: { id: c.id }, data });
        const events: EventInput[] = [];
        if (a.lifecycleStage && a.lifecycleStage !== c.lifecycleStage) {
          events.push({ workspaceId: ctx.workspaceId, type: "contact.lifecycle_changed", objectType: "contact", objectId: c.id, data: { from: c.lifecycleStage, to: a.lifecycleStage } });
        }
        for (const tag of added) events.push({ workspaceId: ctx.workspaceId, type: "contact.tag_added", objectType: "contact", objectId: c.id, data: { tag } });
        const props = changed.filter((k) => k !== "tags" && k !== "lifecycleStage");
        if (props.length) events.push({ workspaceId: ctx.workspaceId, type: "contact.property_changed", objectType: "contact", objectId: c.id, data: { fields: props, source: "mcp" } });
        await emitEvents(events, tx);
        return u;
      });
      return { updated: true, changedFields: changed, contact: contactView(updated) };
    },
  }),
  tool({
    name: "create_company",
    title: "Unternehmen anlegen",
    description: "Legt ein Unternehmen an. Die Domain (ohne www) muss je Sub-Account eindeutig sein und dient der automatischen Zuordnung von Kontakten.",
    access: "write",
    perm: { object: "companies", action: "edit" },
    input: z.object({
      name: z.string().trim().min(1).max(200),
      domain: z.string().trim().max(200).optional(),
      industry: z.string().trim().max(100).optional(),
      size: z.string().trim().max(40).optional(),
      phone: z.string().trim().max(40).optional(),
      website: z.string().trim().max(300).optional(),
      address: z.string().trim().max(500).optional(),
      lifecycleStage: z.string().max(40).optional(),
      ownerId: z.string().max(60).optional(),
      attributes: attrsArg,
    }),
    run: async (a, ctx) => {
      const domain = a.domain ? normalizeDomain(a.domain) : null;
      if (a.domain && !domain) throw new McpToolError("Ungültige Domain.");
      if (domain) {
        const dup = await db.company.findFirst({ where: { workspaceId: ctx.workspaceId, domain }, select: { id: true } });
        if (dup) throw new McpToolError(`Unternehmen mit dieser Domain existiert bereits (id ${dup.id}).`);
      }
      if (a.lifecycleStage) await assertLifecycle(ctx.workspaceId, a.lifecycleStage);
      await assertOwner(ctx.workspaceId, a.ownerId);
      if (a.ownerId) need(ctx, "companies", "edit", a.ownerId);
      await assertAttributes(ctx.workspaceId, "company", a.attributes);
      const c = await db.$transaction(async (tx) => {
        const created = await tx.company.create({
          data: {
            workspaceId: ctx.workspaceId, name: a.name, domain, industry: a.industry, size: a.size, phone: a.phone, website: a.website, address: a.address,
            lifecycleStage: a.lifecycleStage, ownerId: a.ownerId, attributes: mergeAttrs({}, a.attributes) as Prisma.InputJsonValue,
          },
        });
        await emitEvent({ workspaceId: ctx.workspaceId, type: "company.created", objectType: "company", objectId: created.id, data: { source: "mcp" } }, tx);
        return created;
      });
      return { created: true, company: { id: c.id, name: c.name, domain: c.domain } };
    },
  }),
  tool({
    name: "update_company",
    title: "Unternehmen ändern",
    description: "Ändert Stammdaten, Lifecycle-Phase, zuständige Person oder eigene Felder eines Unternehmens (null löscht ein eigenes Feld).",
    access: "write",
    perm: { object: "companies", action: "edit" },
    idempotent: true,
    input: z.object({
      companyId: idArg,
      name: z.string().trim().min(1).max(200).optional(),
      domain: z.string().trim().max(200).nullable().optional(),
      industry: z.string().trim().max(100).optional(),
      size: z.string().trim().max(40).optional(),
      phone: z.string().trim().max(40).optional(),
      website: z.string().trim().max(300).optional(),
      address: z.string().trim().max(500).optional(),
      lifecycleStage: z.string().max(40).optional(),
      ownerId: z.string().max(60).nullable().optional(),
      attributes: attrsArg,
    }),
    run: async (a, ctx) => {
      const c = await db.company.findFirst({ where: { id: a.companyId, workspaceId: ctx.workspaceId } });
      if (!c) throw new McpToolError("Unternehmen nicht gefunden.");
      need(ctx, "companies", "edit", c.ownerId);
      if (a.ownerId !== undefined) need(ctx, "companies", "edit", a.ownerId);
      let domain: string | null | undefined = undefined;
      if (a.domain !== undefined) {
        domain = a.domain === null ? null : normalizeDomain(a.domain);
        if (a.domain !== null && !domain) throw new McpToolError("Ungültige Domain.");
        if (domain) {
          const dup = await db.company.findFirst({ where: { workspaceId: ctx.workspaceId, domain, NOT: { id: c.id } }, select: { id: true } });
          if (dup) throw new McpToolError(`Domain gehört bereits zu Unternehmen ${dup.id}.`);
        }
      }
      if (a.lifecycleStage) await assertLifecycle(ctx.workspaceId, a.lifecycleStage);
      if (a.ownerId) await assertOwner(ctx.workspaceId, a.ownerId);
      await assertAttributes(ctx.workspaceId, "company", a.attributes);
      const { companyId: _id, attributes, ...rest } = a;
      const data: Prisma.CompanyUncheckedUpdateInput = {
        ...Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== undefined && k !== "domain")),
        ...(domain !== undefined ? { domain } : {}),
        ...(attributes ? { attributes: mergeAttrs(c.attributes, attributes) as Prisma.InputJsonValue } : {}),
      };
      if (Object.keys(data).length === 0) throw new McpToolError("Keine Änderung angegeben.");
      const u = await db.company.update({ where: { id: c.id }, data });
      return { updated: true, changedFields: Object.keys(data), company: { id: u.id, name: u.name, domain: u.domain } };
    },
  }),
  tool({
    name: "create_deal",
    title: "Deal anlegen",
    description: "Legt einen Deal an. Ohne stageId landet er in der ersten Phase der ersten Deal-Pipeline. Betrag in Cent.",
    access: "write",
    perm: { object: "deals", action: "edit" },
    input: z.object({
      title: z.string().trim().min(1).max(200),
      stageId: z.string().max(60).optional(),
      valueCents: z.number().int().min(0).max(1e11).default(0),
      contactId: z.string().max(200).optional().describe("Kontakt-ID oder E-Mail"),
      companyId: z.string().max(60).optional(),
      ownerId: z.string().max(60).optional(),
    }),
    run: async (a, ctx) => {
      let stage;
      if (a.stageId) stage = await dealStage(ctx.workspaceId, a.stageId);
      else {
        const p = await db.pipeline.findFirst({
          where: { workspaceId: ctx.workspaceId, objectType: "deal" },
          orderBy: { createdAt: "asc" },
          include: { stages: { orderBy: { position: "asc" }, take: 1 } },
        });
        stage = p?.stages[0];
        if (!stage) throw new McpToolError("Keine Deal-Pipeline vorhanden.");
      }
      const contact = a.contactId ? await findContact(ctx.workspaceId, a.contactId) : null;
      if (contact) need(ctx, "contacts", "read", contact.ownerId);
      await assertCompany(ctx.workspaceId, a.companyId);
      await assertOwner(ctx.workspaceId, a.ownerId);
      if (a.ownerId) need(ctx, "deals", "edit", a.ownerId);
      const d = await db.$transaction(async (tx) => {
        const created = await tx.deal.create({
          data: {
            workspaceId: ctx.workspaceId, pipelineId: stage.pipelineId, stageId: stage.id, title: a.title, valueCents: a.valueCents,
            contactId: contact?.id, companyId: a.companyId ?? contact?.companyId ?? undefined, ownerId: a.ownerId,
          },
        });
        if (contact) await tx.activity.create({ data: { workspaceId: ctx.workspaceId, contactId: contact.id, type: "DEAL", body: `Deal „${a.title}“ über MCP angelegt` } });
        await emitEvent({ workspaceId: ctx.workspaceId, type: "deal.created", objectType: "deal", objectId: created.id, data: { stageId: stage.id, contactId: contact?.id } }, tx);
        return created;
      });
      return { created: true, deal: { id: d.id, title: d.title, stageId: d.stageId, valueCents: d.valueCents } };
    },
  }),
  tool({
    name: "move_deal_stage",
    title: "Deal-Phase ändern",
    description: "Verschiebt einen Deal in eine andere Phase derselben Pipeline. Bei einer Verloren-Phase ist ein Grund Pflicht.",
    access: "write",
    perm: { object: "deals", action: "edit" },
    idempotent: true,
    input: z.object({ dealId: idArg, stageId: idArg, lostReason: z.string().trim().max(500).optional() }),
    run: async (a, ctx) => {
      const deal = await db.deal.findFirst({ where: { id: a.dealId, workspaceId: ctx.workspaceId }, include: { stage: true } });
      if (!deal) throw new McpToolError("Deal nicht gefunden.");
      need(ctx, "deals", "edit", deal.ownerId);
      const stage = await dealStage(ctx.workspaceId, a.stageId);
      if (stage.pipelineId !== deal.pipelineId) throw new McpToolError("Phase gehört zu einer anderen Pipeline.");
      if (stage.id === deal.stageId) return { unchanged: true };
      if (stage.kind === "LOST" && !a.lostReason) throw new McpToolError("Bitte lostReason angeben.");
      await db.$transaction(async (tx) => {
        await tx.deal.update({
          where: { id: deal.id },
          data: {
            stageId: stage.id,
            closedAt: stage.kind === "WON" || stage.kind === "LOST" ? new Date() : null,
            lostReason: stage.kind === "LOST" ? a.lostReason : null,
          },
        });
        if (deal.contactId) {
          await tx.activity.create({
            data: { workspaceId: ctx.workspaceId, contactId: deal.contactId, type: "DEAL", body: `Deal „${deal.title}“: ${deal.stage.name} → ${stage.name} (MCP)` },
          });
        }
        await emitEvent(
          { workspaceId: ctx.workspaceId, type: "deal.stage_changed", objectType: "deal", objectId: deal.id, data: { stageId: stage.id, fromStageId: deal.stageId, contactId: deal.contactId } },
          tx,
        );
      });
      return { moved: true, from: deal.stage.name, to: stage.name };
    },
  }),
  tool({
    name: "create_ticket",
    title: "Ticket anlegen",
    description: "Legt ein Service-Ticket an (ohne stageId im ersten Status der Ticket-Pipeline).",
    access: "write",
    perm: { object: "tickets", action: "edit" },
    input: z.object({
      subject: z.string().trim().min(1).max(200),
      description: z.string().trim().max(10_000).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      stageId: z.string().max(60).optional(),
      contactId: z.string().max(200).optional().describe("Kontakt-ID oder E-Mail"),
      companyId: z.string().max(60).optional(),
      ownerId: z.string().max(60).optional(),
    }),
    run: async (a, ctx) => {
      const stage = await ticketStage(ctx.workspaceId, a.stageId);
      const contact = a.contactId ? await findContact(ctx.workspaceId, a.contactId) : null;
      if (contact) need(ctx, "contacts", "read", contact.ownerId);
      await assertCompany(ctx.workspaceId, a.companyId);
      await assertOwner(ctx.workspaceId, a.ownerId);
      if (a.ownerId) need(ctx, "tickets", "edit", a.ownerId);
      const t = await db.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: {
            workspaceId: ctx.workspaceId, pipelineId: stage.pipelineId, stageId: stage.id, subject: a.subject, description: a.description,
            priority: a.priority, source: "api", contactId: contact?.id, companyId: a.companyId ?? contact?.companyId ?? undefined, ownerId: a.ownerId,
          },
        });
        if (contact) await tx.activity.create({ data: { workspaceId: ctx.workspaceId, contactId: contact.id, type: "SYSTEM", body: `Ticket #${created.numericId} „${a.subject}“ über MCP angelegt` } });
        await emitEvent({ workspaceId: ctx.workspaceId, type: "ticket.created", objectType: "ticket", objectId: created.id, data: { stageId: stage.id, contactId: contact?.id } }, tx);
        return created;
      });
      return { created: true, ticket: { id: t.id, number: t.numericId, subject: t.subject, stageId: t.stageId } };
    },
  }),
  tool({
    name: "update_ticket",
    title: "Ticket ändern",
    description: "Ändert Betreff, Beschreibung, Priorität, zuständige Person oder Status eines Tickets.",
    access: "write",
    perm: { object: "tickets", action: "edit" },
    idempotent: true,
    input: z.object({
      ticketId: idArg,
      subject: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(10_000).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      stageId: z.string().max(60).optional(),
      ownerId: z.string().max(60).nullable().optional(),
    }),
    run: async (a, ctx) => {
      const t = await db.ticket.findFirst({ where: { id: a.ticketId, workspaceId: ctx.workspaceId }, include: { stage: true } });
      if (!t) throw new McpToolError("Ticket nicht gefunden.");
      need(ctx, "tickets", "edit", t.ownerId);
      if (a.ownerId !== undefined) need(ctx, "tickets", "edit", a.ownerId);
      const stage = a.stageId ? await ticketStage(ctx.workspaceId, a.stageId) : null;
      if (stage && stage.pipelineId !== t.pipelineId) throw new McpToolError("Status gehört zu einer anderen Ticket-Pipeline.");
      if (a.ownerId) await assertOwner(ctx.workspaceId, a.ownerId);
      const data: Prisma.TicketUncheckedUpdateInput = {
        ...(a.subject !== undefined ? { subject: a.subject } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.priority ? { priority: a.priority } : {}),
        ...(a.ownerId !== undefined ? { ownerId: a.ownerId } : {}),
        ...(stage && stage.id !== t.stageId ? { stageId: stage.id, closedAt: stage.kind === "CLOSED" ? new Date() : null } : {}),
      };
      if (Object.keys(data).length === 0) throw new McpToolError("Keine Änderung angegeben.");
      await db.$transaction(async (tx) => {
        await tx.ticket.update({ where: { id: t.id }, data });
        if (stage && stage.id !== t.stageId) {
          await emitEvent(
            { workspaceId: ctx.workspaceId, type: "ticket.stage_changed", objectType: "ticket", objectId: t.id, data: { stageId: stage.id, fromStageId: t.stageId } },
            tx,
          );
        }
      });
      return { updated: true, changedFields: Object.keys(data) };
    },
  }),
  tool({
    name: "add_note",
    title: "Notiz hinzufügen",
    description: "Fügt einer Kontakt-Zeitleiste eine Notiz hinzu.",
    access: "write",
    perm: { object: "contacts", action: "edit" },
    input: z.object({ contact: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000) }),
    run: async (a, ctx) => {
      const c = await findContact(ctx.workspaceId, a.contact);
      need(ctx, "contacts", "edit", c.ownerId);
      const n = await db.activity.create({ data: { workspaceId: ctx.workspaceId, contactId: c.id, type: "NOTE", body: a.body, meta: { source: "mcp" } } });
      return { created: true, noteId: n.id };
    },
  }),
  tool({
    name: "create_task",
    title: "Aufgabe anlegen",
    description: "Legt eine Aufgabe an, optional mit Fälligkeit (ISO-Datum oder in N Tagen) und Bezug zu Kontakt oder Deal.",
    access: "write",
    perm: { object: "tasks", action: "edit" },
    input: z.object({
      title: z.string().trim().min(1).max(200),
      dueAt: z.iso.datetime({ offset: true }).optional(),
      dueInDays: z.number().int().min(0).max(365).optional(),
      contact: z.string().max(200).optional().describe("Kontakt-ID oder E-Mail"),
      dealId: z.string().max(60).optional(),
    }),
    run: async (a, ctx) => {
      const contact = a.contact ? await findContact(ctx.workspaceId, a.contact) : null;
      if (contact) need(ctx, "contacts", "read", contact.ownerId);
      if (a.dealId) {
        const d = await db.deal.findFirst({ where: { id: a.dealId, workspaceId: ctx.workspaceId }, select: { id: true, ownerId: true } });
        if (!d) throw new McpToolError("Deal nicht gefunden.");
        need(ctx, "deals", "read", d.ownerId);
      }
      const dueAt = a.dueAt ? new Date(a.dueAt) : a.dueInDays !== undefined ? new Date(Date.now() + a.dueInDays * 864e5) : null;
      // OAuth: Aufgabe gehört dem handelnden Benutzer; API-Schlüssel: ohne Zuständige
      const t = await db.task.create({ data: { workspaceId: ctx.workspaceId, title: a.title, dueAt, contactId: contact?.id, dealId: a.dealId, ownerId: ctx.userId } });
      return { created: true, task: { id: t.id, title: t.title, dueAt: t.dueAt } };
    },
  }),
  tool({
    name: "add_to_list",
    title: "Zu Liste hinzufügen",
    description: "Fügt Kontakte (IDs oder E-Mails, max. 100) einer statischen Liste hinzu (Listen-ID oder numerische ID).",
    access: "write",
    perm: { object: "lists", action: "edit" },
    idempotent: true,
    input: z.object({
      list: z.union([idArg, z.number().int().positive()]).describe("Listen-ID oder numerische ID"),
      contacts: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    }),
    run: async (a, ctx) => {
      const list = await db.contactList.findFirst({
        where: { workspaceId: ctx.workspaceId, ...(typeof a.list === "number" ? { numericId: a.list } : { id: a.list }) },
      });
      if (!list) throw new McpToolError("Liste nicht gefunden.");
      if (list.kind !== "static") throw new McpToolError("Nur statische Listen lassen sich direkt befüllen.");
      const ids = a.contacts.filter((c) => !c.includes("@"));
      const emails = a.contacts.filter((c) => c.includes("@")).map((e) => e.toLowerCase());
      const found = await db.contact.findMany({
        where: { workspaceId: ctx.workspaceId, OR: [{ id: { in: ids } }, { email: { in: emails } }], AND: [ownerScope(ctx, "contacts") as Prisma.ContactWhereInput] },
        select: { id: true, email: true },
      });
      const existing = await db.contactListMember.findMany({ where: { listId: list.id, contactId: { in: found.map((f) => f.id) } }, select: { contactId: true } });
      const already = new Set(existing.map((e) => e.contactId));
      const fresh = found.filter((f) => !already.has(f.id));
      await db.$transaction(async (tx) => {
        await tx.contactListMember.createMany({ data: fresh.map((f) => ({ listId: list.id, contactId: f.id })), skipDuplicates: true });
        await emitEvents(
          fresh.map((f) => ({ workspaceId: ctx.workspaceId, type: "contact.list_added" as const, objectType: "contact" as const, objectId: f.id, data: { listId: list.id } })),
          tx,
        );
      });
      const foundKeys = new Set([...found.map((f) => f.id), ...found.map((f) => f.email ?? "")]);
      return { added: fresh.length, alreadyMembers: already.size, notFound: a.contacts.filter((c) => !foundKeys.has(c.includes("@") ? c.toLowerCase() : c)) };
    },
  }),

  // ---------------- Mit Freigabe (Außenwirkung / unumkehrbar) ----------------
  tool({
    name: "send_email",
    title: "E-Mail an Kontakt (mit Freigabe)",
    description:
      "Bereitet eine persönliche E-Mail an einen Kontakt vor. Sie wird NICHT sofort versendet, sondern landet im Freigabe-Eingang; erst ein Mensch gibt sie frei. Gesperrte Adressen werden nie beliefert.",
    access: "approval",
    perm: { object: "email", action: "edit" },
    input: z.object({
      contact: z.string().trim().min(1).max(200).describe("Kontakt-ID oder E-Mail"),
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(20_000).describe("Klartext der E-Mail"),
    }),
    run: async (a, ctx) => {
      const c = await findContact(ctx.workspaceId, a.contact);
      need(ctx, "contacts", "read", c.ownerId);
      if (!c.email) throw new McpToolError("Kontakt hat keine E-Mail-Adresse.");
      const appr = await requestApproval({
        workspaceId: ctx.workspaceId,
        kind: "mail.send",
        title: `E-Mail an ${c.email}: ${a.subject}`,
        summary: a.body.slice(0, 500),
        payload: { contactId: c.id, subject: a.subject, body: a.body },
        requestedBy: ctx.actor,
      });
      return { status: "wartet_auf_freigabe", approvalId: appr.id, link: approvalLink(appr.id) };
    },
  }),
  tool({
    name: "delete_contact",
    title: "Kontakt löschen (mit Freigabe)",
    description: "Beantragt das endgültige Löschen eines Kontakts. Wird erst nach Freigabe durch einen Menschen ausgeführt.",
    access: "approval",
    perm: { object: "contacts", action: "delete" },
    destructive: true,
    input: z.object({ contact: z.string().trim().min(1).max(200), reason: z.string().trim().min(3).max(500) }),
    run: async (a, ctx) => {
      const c = await findContact(ctx.workspaceId, a.contact);
      need(ctx, "contacts", "delete", c.ownerId);
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.id;
      const appr = await requestApproval({
        workspaceId: ctx.workspaceId,
        kind: "contact.delete",
        title: `Kontakt löschen: ${name}`,
        summary: `Grund: ${a.reason}`,
        payload: { contactId: c.id, reason: a.reason },
        requestedBy: ctx.actor,
      });
      return { status: "wartet_auf_freigabe", approvalId: appr.id, link: approvalLink(appr.id) };
    },
  }),
];

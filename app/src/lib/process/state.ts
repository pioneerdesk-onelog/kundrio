import { db } from "@/lib/db";
import type { ObjectType } from "./definition";
import type { ProcessState } from "./conditions";

// Lädt den aktuellen Objektzustand (inkl. verknüpfter Objekte) für Bedingungen und Aktionen.

export type LoadedState = {
  state: ProcessState;
  ids: { contactId?: string; companyId?: string; dealId?: string; ticketId?: string };
};

const plain = <T extends object>(o: T | null | undefined) => (o ? ({ ...o } as unknown as Record<string, unknown>) : null);

async function contactState(workspaceId: string, id: string): Promise<Record<string, unknown> | null> {
  const c = await db.contact.findFirst({ where: { id, workspaceId } });
  if (!c) return null;
  const last = await db.activity.findFirst({
    where: { contactId: id, type: { in: ["FORM", "NOTE", "SYSTEM", "EMAIL_IN"] } },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  const emailDomain = c.email?.split("@")[1]?.toLowerCase() ?? null;
  return { ...plain(c)!, emailDomain, lastActivityText: last?.body?.slice(0, 4000) ?? null };
}

async function stageState(stageId: string | null | undefined) {
  if (!stageId) return null;
  const s = await db.stage.findUnique({ where: { id: stageId }, select: { id: true, name: true, kind: true, position: true } });
  return s ? { ...s } : null;
}

export async function loadState(workspaceId: string, objectType: ObjectType, objectId: string): Promise<LoadedState | null> {
  const ids: LoadedState["ids"] = {};
  const state: ProcessState = {};

  if (objectType === "contact") {
    const c = await contactState(workspaceId, objectId);
    if (!c) return null;
    state.contact = c;
    ids.contactId = objectId;
    ids.companyId = (c.companyId as string | null) ?? undefined;
  } else if (objectType === "company") {
    const co = await db.company.findFirst({ where: { id: objectId, workspaceId } });
    if (!co) return null;
    state.company = plain(co);
    ids.companyId = objectId;
  } else if (objectType === "deal") {
    const d = await db.deal.findFirst({ where: { id: objectId, workspaceId } });
    if (!d) return null;
    state.deal = { ...plain(d)!, stage: await stageState(d.stageId) };
    ids.dealId = objectId;
    ids.contactId = d.contactId ?? undefined;
    ids.companyId = d.companyId ?? undefined;
  } else {
    const t = await db.ticket.findFirst({ where: { id: objectId, workspaceId } });
    if (!t) return null;
    state.ticket = { ...plain(t)!, stage: await stageState(t.stageId) };
    ids.ticketId = objectId;
    ids.contactId = t.contactId ?? undefined;
    ids.companyId = t.companyId ?? undefined;
  }

  // Verknüpfte Objekte nachladen (für Bedingungen wie contact.lifecycleStage bei Deals)
  if (!state.contact && ids.contactId) state.contact = await contactState(workspaceId, ids.contactId);
  if (state.contact && !ids.companyId && state.contact.companyId) ids.companyId = state.contact.companyId as string;
  if (!state.company && ids.companyId) state.company = plain(await db.company.findFirst({ where: { id: ids.companyId, workspaceId } }));
  return { state, ids };
}

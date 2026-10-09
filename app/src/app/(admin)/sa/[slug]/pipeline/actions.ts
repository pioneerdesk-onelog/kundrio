"use server";

import { fireTrigger } from "@/lib/automation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { assertOwnerAssignable, assertRecord, guard } from "@/lib/permissions/guard";
import { euroToCents } from "@/lib/a-format";
import { emitEvent } from "@/lib/events";
import { isValidOwner } from "@/lib/objects/defaults";

export async function createDeal(slug: string, fd: FormData) {
  const { ws, access } = await guard(slug, { object: "deals", action: "edit" });
  const data = z
    .object({
      title: z.string().trim().min(1, "Titel fehlt").max(200),
      stageId: z.string().min(1),
      contactId: z.string().optional().transform((v) => v || null),
      companyId: z.string().optional().transform((v) => v || null),
      ownerId: z.string().optional().transform((v) => v || null),
      value: z.string().optional(),
    })
    .parse({
      title: fd.get("title"),
      stageId: fd.get("stageId"),
      contactId: fd.get("contactId") ?? undefined,
      companyId: fd.get("companyId") ?? undefined,
      ownerId: fd.get("ownerId") ?? undefined,
      value: fd.get("value") ?? undefined,
    });

  const stage = await db.stage.findFirst({ where: { id: data.stageId, pipeline: { workspaceId: ws.id, objectType: "deal" } } });
  if (!stage) throw new Error("Phase nicht gefunden");
  if (data.contactId) {
    const ok = await db.contact.findFirst({ where: { id: data.contactId, workspaceId: ws.id }, select: { id: true, ownerId: true } });
    if (!ok || !can(access, "contacts", "read", ok.ownerId)) throw new Error("Kontakt nicht gefunden");
  }
  let companyId = data.companyId;
  if (companyId && !(await db.company.findFirst({ where: { id: companyId, workspaceId: ws.id }, select: { id: true } }))) throw new Error("Unternehmen nicht gefunden");
  if (!companyId && data.contactId) {
    // Unternehmen des Kontakts übernehmen (wie HubSpot)
    companyId = (await db.contact.findUnique({ where: { id: data.contactId }, select: { companyId: true } }))?.companyId ?? null;
  }
  if (data.ownerId && !(await isValidOwner(ws.id, data.ownerId))) throw new Error("Zuständige Person ist nicht berechtigt");
  // Ohne Angabe: wer nur eigene/Team-Deals bearbeitet, wird selbst zuständig
  if (!data.ownerId && access.perms.objects.deals.edit !== "all") data.ownerId = access.userId;
  assertOwnerAssignable(access, "deals", data.ownerId);
  const last = await db.deal.aggregate({ where: { stageId: stage.id, workspaceId: ws.id }, _max: { position: true } });
  await db.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: {
        workspaceId: ws.id,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        contactId: data.contactId,
        companyId,
        ownerId: data.ownerId,
        title: data.title,
        valueCents: euroToCents(data.value),
        position: (last._max.position ?? -1) + 1,
        closedAt: stage.kind === "OPEN" ? null : new Date(),
      },
    });
    await tx.activity.create({
      data: { workspaceId: ws.id, contactId: data.contactId, type: "DEAL", body: `Deal „${deal.title}“ angelegt (${stage.name})`, meta: { dealId: deal.id } },
    });
    await emitEvent({ workspaceId: ws.id, type: "deal.created", objectType: "deal", objectId: deal.id, data: { stageId: stage.id, contactId: data.contactId, companyId } }, tx);
  });
  revalidatePath(`/sa/${slug}/pipeline`);
}

export async function moveDeal(slug: string, dealId: string, stageId: string, lostReason?: string): Promise<void | { error: string }> {
  let ctx;
  try {
    ctx = await guard(slug, { object: "deals", action: "edit" });
  } catch {
    return { error: "Keine Berechtigung, Deals zu verschieben." };
  }
  const { ws, access } = ctx;
  const [deal, stage] = await Promise.all([
    db.deal.findFirst({ where: { id: dealId, workspaceId: ws.id }, include: { stage: true } }),
    db.stage.findFirst({ where: { id: stageId, pipeline: { workspaceId: ws.id, objectType: "deal" } } }),
  ]);
  if (!deal || !stage) throw new Error("Deal oder Phase nicht gefunden");
  if (!can(access, "deals", "edit", deal.ownerId)) return { error: "Keine Berechtigung für diesen Deal." };
  if (stage.pipelineId !== deal.pipelineId) throw new Error("Phase gehört zu einer anderen Pipeline");
  if (deal.stageId === stage.id) return;

  const reason = stage.kind === "LOST" ? z.string().trim().max(500).parse(lostReason ?? "") || null : null;
  const last = await db.deal.aggregate({ where: { stageId: stage.id, workspaceId: ws.id }, _max: { position: true } });

  await db.deal.update({
    where: { id: deal.id },
    data: {
      stageId: stage.id,
      position: (last._max.position ?? -1) + 1,
      closedAt: stage.kind === "OPEN" ? null : new Date(),
      lostReason: stage.kind === "LOST" ? reason : null,
    },
  });
  await db.activity.create({
    data: {
      workspaceId: ws.id,
      contactId: deal.contactId,
      type: "DEAL",
      body: `Deal „${deal.title}“: ${deal.stage.name} → ${stage.name}${reason ? ` (Grund: ${reason})` : ""}`,
      meta: { dealId: deal.id, from: deal.stageId, to: stage.id },
    },
  });
  await fireTrigger(ws.id, "DEAL_STAGE_CHANGED", { contactId: deal.contactId ?? undefined, dealId: deal.id, stageId: stage.id, fromStageId: deal.stageId });
  revalidatePath(`/sa/${slug}/pipeline`);
}

export async function deleteDeal(slug: string, dealId: string) {
  const { ws, access } = await guard(slug, { object: "deals", action: "delete" });
  const deal = await db.deal.findFirst({ where: { id: dealId, workspaceId: ws.id }, select: { ownerId: true } });
  if (!deal) return;
  assertRecord(access, "deals", "delete", deal.ownerId);
  await db.deal.deleteMany({ where: { id: dealId, workspaceId: ws.id } });
  revalidatePath(`/sa/${slug}/pipeline`);
}

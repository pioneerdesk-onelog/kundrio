import "server-only";
import { db } from "@/lib/db";
import type { CatalogData } from "./fields";

// Lädt die Daten des Sub-Accounts für den Feld-Katalog (nur dieser Workspace → Mandantentrennung).
export async function loadCatalogData(workspaceId: string): Promise<CatalogData> {
  const [stages, lists, pipelines, templates, webhooks, members, admins, props, forms, tags, meetingTypes, inboxes] = await Promise.all([
    db.lifecycleStage.findMany({ where: { workspaceId }, orderBy: { position: "asc" } }),
    db.contactList.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.pipeline.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: { stages: { orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } } },
    }),
    db.emailTemplate.findMany({ where: { workspaceId, isActive: true }, orderBy: { name: "asc" }, select: { numericId: true, name: true } }),
    db.webhook.findMany({ where: { workspaceId, active: true }, select: { numericId: true, url: true, description: true } }),
    db.membership.findMany({ where: { workspaceId, user: { active: true } }, include: { user: { select: { id: true, name: true } } } }),
    db.user.findMany({ where: { active: true, OR: [{ isAgencyAdmin: true }, { agencyRole: { in: ["owner", "admin"] } }] }, select: { id: true, name: true } }),
    db.propertyDefinition.findMany({ where: { workspaceId }, orderBy: { label: "asc" }, select: { key: true, label: true, objectType: true, type: true, options: true } }),
    db.form.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "Contact" WHERE "workspaceId" = ${workspaceId} ORDER BY 1 LIMIT 500`,
    db.meetingType.findMany({ where: { workspaceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, durationMin: true } }),
    db.inbox.findMany({ where: { workspaceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, address: true } }),
  ]);
  const users = new Map<string, string>();
  for (const m of members) users.set(m.user.id, m.user.name);
  for (const a of admins) users.set(a.id, a.name);
  return {
    properties: props,
    lifecycleStages: stages.map((s) => ({ value: s.key, label: s.label })),
    stages: pipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: `${p.name} · ${s.name}`, objectType: p.objectType, kind: s.kind }))),
    lists: lists.map((l) => ({ value: l.id, label: l.name })),
    users: [...users].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    forms: forms.map((f) => ({ value: f.id, label: f.name })),
    templates: templates.map((t) => ({ value: String(t.numericId), label: `${t.name} (#${t.numericId})` })),
    webhooks: webhooks.map((w) => ({ value: String(w.numericId), label: w.description ? `${w.description} (#${w.numericId})` : `${w.url} (#${w.numericId})` })),
    tags: tags.map((t) => t.tag).filter(Boolean),
    meetingTypes: meetingTypes.map((m) => ({ value: m.id, label: `${m.name} (${m.durationMin} min)` })),
    inboxes: inboxes.map((i) => ({ value: i.id, label: `${i.name} (${i.address})`, kind: i.kind })),
  };
}

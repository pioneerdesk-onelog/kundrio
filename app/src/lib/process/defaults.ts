import type { Prisma, PrismaClient } from "@prisma/client";
import { validateDefinition } from "./definition";
import { MEETING_TYPE_REF, PROCESS_TEMPLATES, TEMPLATE_PROPERTIES, type ProcessTemplate } from "./templates";
import type { ProcessDefinition } from "./definition";

// Legt die Best-Practice-Prozesse für einen Sub-Account an (idempotent über templateKey).
// Ohne Außenwirkung: veröffentlicht + aktiv. Mit E-Mail/Webhook: Entwurf – Text prüfen und freigeben.
// Bewusst ohne server-only, damit der Seed (prisma/seed.ts) es nutzen kann.

type Db = PrismaClient | Prisma.TransactionClient;

export async function ensureDefaultProcesses(db: Db, workspaceId: string): Promise<{ created: string[] }> {
  const created: string[] = [];
  // Eigene Felder der Vorlagen sicherstellen (vorhandene bleiben unverändert)
  await db.propertyDefinition.createMany({
    data: TEMPLATE_PROPERTIES.map((p) => ({ workspaceId, objectType: p.objectType, key: p.key, label: p.label, type: p.type, options: p.options, source: "vorlage" })),
    skipDuplicates: true,
  });
  for (const t of PROCESS_TEMPLATES) {
    const exists = await db.process.findFirst({ where: { workspaceId, templateKey: t.key }, select: { id: true } });
    if (exists) continue;
    const definition = await resolveTemplate(db, workspaceId, t);
    if (!definition) continue; // nötige Daten (z. B. Terminvorlage) fehlen in diesem Sub-Account → später erneut
    const validation = validateDefinition(definition, t.objectType);
    if (!validation.ok) throw new Error(`Vorlage ${t.key} ist ungültig: ${validation.issues.map((i) => i.message).join("; ")}`);
    const now = new Date();
    const p = await db.process.create({
      data: {
        workspaceId,
        name: t.name,
        description: validation.external ? `${t.description}\n\nHinweis: Hat Außenwirkung (E-Mail, WhatsApp/SMS, Webhook) – Texte prüfen und freigeben, dann aktivieren.` : t.description,
        objectType: t.objectType,
        templateKey: t.key,
        status: validation.external ? "DRAFT" : "ACTIVE",
      },
    });
    const v = await db.processVersion.create({
      data: {
        processId: p.id,
        version: 1,
        definition: definition as unknown as Prisma.InputJsonValue,
        validation: validation as unknown as Prisma.InputJsonValue,
        external: validation.external,
        createdBy: "system",
        ...(validation.external ? {} : { publishedAt: now, publishedBy: "system" }),
      },
    });
    if (!validation.external) await db.process.update({ where: { id: p.id }, data: { activeVersionId: v.id } });
    created.push(t.key);
  }
  return { created };
}

/**
 * Löst Platzhalter der Vorlage gegen den Sub-Account auf (z. B. Terminvorlage per Name).
 * Fehlt eine Terminvorlage, wird sie mit sinnvollen Standardwerten angelegt.
 */
export async function resolveTemplate(db: Db, workspaceId: string, t: Pick<ProcessTemplate, "definition">): Promise<ProcessDefinition | null> {
  const def = JSON.parse(JSON.stringify(t.definition)) as ProcessDefinition;
  for (const n of def.nodes) {
    const cfg = n.config as Record<string, unknown>;
    const ref = typeof cfg.meetingTypeId === "string" && cfg.meetingTypeId.startsWith(MEETING_TYPE_REF) ? cfg.meetingTypeId.slice(MEETING_TYPE_REF.length) : null;
    if (!ref) continue;
    let mt = await db.meetingType.findFirst({ where: { workspaceId, name: ref }, select: { id: true } });
    if (!mt) {
      const preset = MEETING_TYPE_PRESETS[ref];
      if (!preset) return null;
      mt = await db.meetingType.create({ data: { workspaceId, name: ref, ...preset, addToTeamCalendar: true }, select: { id: true } });
    }
    cfg.meetingTypeId = mt.id;
  }
  return def;
}

// Mindestangaben für Terminvorlagen, die Prozess-Vorlagen voraussetzen (gleiche Werte wie die Kalender-Standardvorlagen)
const MEETING_TYPE_PRESETS: Record<string, { titleTemplate: string; description: string; durationMin: number; bufferMin: number; videoProvider: string; reminders: number[] }> = {
  "Onboarding-Kickoff": {
    titleTemplate: "Onboarding-Kickoff {{ company.name | default: \"\" }}",
    description:
      "Hallo {{ contact.FIRSTNAME | default: \"zusammen\" }},\n\nherzlich willkommen! Im Kickoff stimmen wir Ziele, Ansprechpartner und den Zeitplan ab.\n\nVideo-Link: {{ meeting.joinUrl }}\n\nViele Grüße\n{{ owner.name }}",
    durationMin: 45,
    bufferMin: 15,
    videoProvider: "google_meet",
    reminders: [1440, 60],
  },
};

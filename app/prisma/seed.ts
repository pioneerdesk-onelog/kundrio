// Legt Agentur + Sub-Accounts an. Idempotent: mehrfaches Ausführen ist unschädlich.
import { PrismaClient } from "@prisma/client";
import { ensureDefaultProcesses } from "../src/lib/process/defaults";
import { DEFAULT_LIFECYCLE, TICKET_STAGES } from "../src/lib/objects/lifecycle";

const db = new PrismaClient();

const WORKSPACES = [
  { slug: "demo-software", name: "Demo Software", domain: "software.example.com", brandPrimary: "#0E7490", brandAccent: "#334155" },
  { slug: "demo-akademie", name: "Demo Akademie", domain: "akademie.example.com", brandPrimary: "#0D6B83", brandAccent: "#F2913A" },
  { slug: "demo-medien", name: "Demo Medien", domain: "medien.example.com", brandPrimary: "#5B3FA0", brandAccent: "#E9E4F5" },
  { slug: "demo-hosting", name: "Demo Hosting", domain: "hosting.example.com", brandPrimary: "#B4471A", brandAccent: "#F6E7DE" },
];

const STAGES: { name: string; kind: "OPEN" | "WON" | "LOST" }[] = [
  { name: "Neu", kind: "OPEN" },
  { name: "Kontaktiert", kind: "OPEN" },
  { name: "Qualifiziert", kind: "OPEN" },
  { name: "Angebot", kind: "OPEN" },
  { name: "Gewonnen", kind: "WON" },
  { name: "Verloren", kind: "LOST" },
];

async function main() {
  const agency =
    (await db.agency.findFirst({ where: { name: "Demo-Agentur" } })) ??
    (await db.agency.create({ data: { name: "Demo-Agentur" } }));

  for (const w of WORKSPACES) {
    const ws = await db.workspace.upsert({
      where: { slug: w.slug },
      update: {},
      create: {
        ...w,
        agencyId: agency.id,
        mailFromName: w.name,
        mailFromEmail: `info@${w.domain}`,
      },
    });

    if ((await db.pipeline.count({ where: { workspaceId: ws.id, objectType: "deal" } })) === 0) {
      await db.pipeline.create({
        data: {
          workspaceId: ws.id,
          name: "Vertrieb",
          stages: { create: STAGES.map((s, i) => ({ ...s, position: i })) },
        },
      });
    }

    // HubSpot-Standards: Lifecycle-Phasen und Ticket-Pipeline (gleiche Logik wie src/lib/objects/defaults.ts)
    await db.lifecycleStage.createMany({
      data: DEFAULT_LIFECYCLE.map((s, i) => ({ workspaceId: ws.id, key: s.key, label: s.label, position: i })),
      skipDuplicates: true,
    });
    if ((await db.pipeline.count({ where: { workspaceId: ws.id, objectType: "ticket" } })) === 0) {
      await db.pipeline.create({
        data: { workspaceId: ws.id, name: "Support", objectType: "ticket", stages: { create: TICKET_STAGES.map((s, i) => ({ ...s, position: i })) } },
      });
    }

    await db.channelAccount.upsert({
      where: { workspaceId_platform_handle: { workspaceId: ws.id, platform: "website", handle: w.domain } },
      update: {},
      create: { workspaceId: ws.id, platform: "website", handle: w.domain, url: `https://${w.domain}` },
    });

    await db.wikiPage.upsert({
      where: { workspaceId_slug: { workspaceId: ws.id, slug: "start" } },
      update: {},
      create: {
        workspaceId: ws.id,
        slug: "start",
        title: `${w.name} – Übersicht`,
        body: startBody(w),
        revisions: { create: { body: startBody(w), author: "mensch", note: "Seed" } },
      },
    });
  }
  // Best-Practice-Prozesse je Sub-Account (idempotent)
  for (const ws of await db.workspace.findMany({ select: { id: true } })) await ensureDefaultProcesses(db, ws.id);
  console.log(`Agentur "${agency.name}" mit ${WORKSPACES.length} Sub-Accounts bereit.`);
}

function startBody(w: { name: string; domain: string }) {
  return `# ${w.name}\n\nWebsite: https://${w.domain}\n\n## Angebot\n_noch offen_\n\n## Zielgruppe\n_noch offen_\n\n## Häufige Fragen\n_noch offen_\n`;
}

main().finally(() => db.$disconnect());

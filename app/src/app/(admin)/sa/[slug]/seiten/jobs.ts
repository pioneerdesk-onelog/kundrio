import "server-only";
import { db } from "@/lib/db";

export type PageJob = { id: string; type: string; status: string; lastError: string | null; updatedAt: Date };

/** Letzte KI-Jobs (Entwurf/Übersetzung) je Seite dieses Workspaces. */
export async function pageJobs(workspaceId: string): Promise<Map<string, PageJob>> {
  const jobs = await db.job.findMany({
    where: { type: { in: ["page.draft", "page.translate"] }, payload: { path: ["workspaceId"], equals: workspaceId } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const map = new Map<string, PageJob>();
  for (const j of jobs) {
    const pageId = (j.payload as { pageId?: string }).pageId;
    if (pageId && !map.has(pageId)) map.set(pageId, j);
  }
  return map;
}

export function jobLabel(j: PageJob | undefined): { text: string; tone: "accent" | "bad" | "ok" } | null {
  if (!j) return null;
  const what = j.type === "page.draft" ? "KI-Entwurf" : "Übersetzung";
  if (j.status === "queued" || j.status === "running") return { text: `${what} läuft …`, tone: "accent" };
  if (j.status === "failed") return { text: `${what} fehlgeschlagen`, tone: "bad" };
  return null;
}

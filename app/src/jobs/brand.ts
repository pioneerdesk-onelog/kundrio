import type { JobHandler } from "@/lib/jobs";
import { extractFromFiles, extractFromWebsite } from "@/lib/brand/service";
import { setBrandStatus } from "@/lib/brand/suggestions";

// Auswertung von Brandbook-Dateien bzw. Website-CI im Hintergrund. Ergebnis: Vorschläge zum Übernehmen.
export const handlers: Record<string, JobHandler> = {
  "brand.extract": async (p) => {
    const workspaceId = String(p.workspaceId);
    const mode = p.mode === "website" ? "website" : "files";
    await setBrandStatus(workspaceId, { state: "running", mode, at: new Date().toISOString() });
    try {
      const r =
        mode === "website"
          ? await extractFromWebsite(workspaceId, String(p.domain ?? ""), p.requestedBy ? String(p.requestedBy) : undefined)
          : await extractFromFiles(workspaceId, Array.isArray(p.fileIds) ? p.fileIds.map(String) : []);
      const message = r.aiError ? `Fertig. Markenstimme konnte nicht ausgewertet werden (KI: ${r.aiError.slice(0, 160)}).` : "Fertig.";
      await setBrandStatus(workspaceId, { state: "done", mode, at: new Date().toISOString(), created: r.created, message });
    } catch (e) {
      await setBrandStatus(workspaceId, { state: "failed", mode, at: new Date().toISOString(), message: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      throw e;
    }
  },
};

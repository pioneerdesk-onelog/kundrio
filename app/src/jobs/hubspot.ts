import type { JobHandler } from "@/lib/jobs";
import { failHubspotRun, runHubspotStep, type HsStepPayload } from "@/lib/migrate/hubspot-import";

export const handlers: Record<string, JobHandler> = {
  // HubSpot-Import in Etappen (Zuständige → Eigenschaften → Pipelines → Unternehmen → Kontakte → Deals → Tickets → Notizen)
  "migrate.hubspot": async (p) => {
    await runHubspotStep(p as unknown as HsStepPayload);
  },
};

// Endgültig gescheitert: Lauf als fehlgeschlagen markieren und verschlüsselten Schlüssel aus allen Jobs entfernen
export async function onJobFailed(_jobId: string, payload: Record<string, unknown>) {
  await failHubspotRun(String(payload.workspaceId), String(payload.runId), "Etappe nach mehreren Versuchen endgültig gescheitert");
}

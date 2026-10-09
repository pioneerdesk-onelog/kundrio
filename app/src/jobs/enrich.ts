import type { JobHandler } from "@/lib/jobs";
import { enrichCompany, saveResult } from "@/lib/enrich/company";
import { enrichContact } from "@/lib/enrich/contact";

// Anreicherung im Hintergrund. Ergebnis (Seiten, Vorschläge, Hinweise) liegt in AppSetting `enrich:last:<art>:<id>`.
// Fehler werden sichtbar gespeichert und geworfen (Wiederholung durch den Worker).

const run = (kind: "company" | "contact", fn: (ws: string, id: string) => ReturnType<typeof enrichCompany>): JobHandler =>
  async (p) => {
    const workspaceId = String(p.workspaceId);
    const id = String(p.objectId);
    try {
      const r = await fn(workspaceId, id);
      await saveResult(kind, id, r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await saveResult(kind, id, { ok: false, pages: [], suggestions: 0, notes: [], error: msg.slice(0, 300) });
      throw e;
    }
  };

export const handlers: Record<string, JobHandler> = {
  "enrich.company": run("company", enrichCompany),
  "enrich.contact": run("contact", enrichContact),
};

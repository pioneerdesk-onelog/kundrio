import type { JobHandler } from "@/lib/jobs";
import { db } from "@/lib/db";
import { sendCampaign } from "@/lib/mail";

export const handlers: Record<string, JobHandler> = {
  // Kampagne im Hintergrund versenden. Bereits versendete Empfänger werden übersprungen.
  "campaign.send": async (p) => {
    const id = String(p.campaignId);
    const c = await db.campaign.findUnique({ where: { id } });
    if (!c || c.status === "SENT") return; // doppelt eingereiht oder gelöscht
    // Abgebrochener Lauf (Worker-Absturz): wieder aufnehmen, Freigabe bleibt bestehen
    if (c.status === "SENDING" && c.approvedAt) await db.campaign.update({ where: { id }, data: { status: "APPROVED" } });
    await sendCampaign(id);
  },
};

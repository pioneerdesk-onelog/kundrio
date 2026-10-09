import type { JobHandler } from "@/lib/jobs";
import { processWebhookPayload } from "@/lib/messaging/inbound";
import { reviveParsed } from "@/lib/messaging/webhook";

export const handlers: Record<string, JobHandler> = {
  // Webhook-Inhalt von WhatsApp/SMS verarbeiten (idempotent: Entdoppeln über externalId)
  "messaging.webhook": async (p) => {
    await processWebhookPayload(String(p.inboxId), reviveParsed(p.parsed));
  },
};

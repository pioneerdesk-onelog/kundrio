import { registerChannelAdapter } from "../inbox/channel";
import { sevenSmsAdapter } from "./seven-sms";
import { whatsappCloudAdapter } from "./whatsapp-cloud";

// Vom Posteingang importieren (Seiteneffekt): registriert die Messaging-Adapter.
registerChannelAdapter(whatsappCloudAdapter);
registerChannelAdapter(sevenSmsAdapter);

export const MESSAGING_PROVIDERS = {
  whatsapp_cloud: { kind: "whatsapp", label: whatsappCloudAdapter.label },
  seven: { kind: "sms", label: sevenSmsAdapter.label },
} as const;
export type MessagingProvider = keyof typeof MESSAGING_PROVIDERS;

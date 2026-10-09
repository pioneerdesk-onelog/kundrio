import "server-only";
import { registerChannelAdapter } from "./channel";
import { emailImapAdapter } from "./channels/email-imap";
// WhatsApp (Meta Cloud API) und SMS (seven.io)
import "@/lib/messaging/register";

// Alle Kanal-Adapter registrieren. Weitere Kanäle (WhatsApp/SMS aus src/lib/messaging) tragen hier
// ihren Import ein, z. B.: import "@/lib/messaging/register";
registerChannelAdapter(emailImapAdapter);

export {};

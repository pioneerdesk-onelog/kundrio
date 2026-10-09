import { z } from "zod";

// Nicht geheime Einstellungen einer Inbox (Inbox.config). Rein, auch im Client nutzbar.

export const ASSIGNMENT_MODES = { manual: "Manuell (nicht zuweisen)", round_robin: "Rundlauf (gleichmäßig verteilen)" } as const;
export type AssignmentMode = keyof typeof ASSIGNMENT_MODES;

export const emailConfigSchema = z.object({
  imapHost: z.string().trim().min(1).max(200),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  imapUser: z.string().trim().min(1).max(200),
  folder: z.string().trim().min(1).max(200).default("INBOX"),
  smtpHost: z.string().trim().min(1).max(200),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().trim().min(1).max(200),
  fromName: z.string().trim().max(120).optional(),
  markSeen: z.boolean().default(false),
});
export type EmailConfig = z.infer<typeof emailConfigSchema>;

export const inboxCommonSchema = z.object({
  signature: z.string().max(5000).optional(),
  assignment: z.enum(Object.keys(ASSIGNMENT_MODES) as [AssignmentMode, ...AssignmentMode[]]).default("manual"),
  /** Rundlauf nur auf diese Benutzer (leer = alle aktiven Mitglieder mit E-Mail-Bearbeitungsrecht) */
  assigneeIds: z.array(z.string()).default([]),
});

export type InboxConfig = Partial<EmailConfig> &
  z.infer<typeof inboxCommonSchema> & {
    /** IMAP-Merker je Ordner: zuletzt abgerufene UID und UIDVALIDITY */
    cursor?: Record<string, { uidValidity: string; lastUid: number }>;
  };

export function parseInboxConfig(value: unknown): InboxConfig {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const common = inboxCommonSchema.safeParse(v);
  return { ...(v as Partial<EmailConfig>), ...(common.success ? common.data : { assignment: "manual", assigneeIds: [] }), cursor: (v.cursor as InboxConfig["cursor"]) ?? {} };
}

export const STATUS_LABELS: Record<string, string> = { open: "Offen", pending: "Wartet auf Kunde", snoozed: "Zurückgestellt", closed: "Erledigt" };
export const KIND_LABELS: Record<string, string> = { email: "E-Mail", whatsapp: "WhatsApp", sms: "SMS", webchat: "Web-Chat" };

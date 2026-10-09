import "server-only";
import type { Inbox } from "@prisma/client";
import { open, seal } from "@/lib/migrate/secretbox";

// Zugangsdaten eines Kanals (z. B. IMAP/SMTP-Passwort) – nur verschlüsselt in Inbox.credentials.

export function sealCredentials(values: Record<string, string>): string {
  return seal(JSON.stringify(values));
}

export function openCredentials(inbox: Pick<Inbox, "credentials">): Record<string, string> {
  if (!inbox.credentials) return {};
  try {
    const v = JSON.parse(open(inbox.credentials)) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    // z. B. nach Wechsel von APP_SECRET – Verbindung muss neu eingerichtet werden
    return {};
  }
}

/** Zugangsdaten nie ausgeben: nur, welche Felder gesetzt sind. */
export function credentialSummary(inbox: Pick<Inbox, "credentials">): string[] {
  return Object.keys(openCredentials(inbox));
}

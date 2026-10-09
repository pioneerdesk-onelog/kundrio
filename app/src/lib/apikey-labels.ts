import type { Scope } from "./apikey";

// Deutsche Beschreibung je API-Berechtigung (Formular „Neuen Schlüssel anlegen“). Record<Scope, …> erzwingt Vollständigkeit.
export const SCOPE_LABEL: Record<Scope, string> = {
  "mail:send": "E-Mails senden (smtp/email) und Versandprotokoll lesen",
  "templates:read": "Vorlagen lesen",
  "contacts:read": "Kontakte lesen",
  "contacts:write": "Kontakte anlegen/ändern",
  "webhooks:manage": "Webhooks verwalten",
  "mcp:read": "KI-Steuerung (MCP): Daten lesen",
  "mcp:write": "KI-Steuerung (MCP): Daten ändern, Außenwirkung nur nach Freigabe",
};

import "server-only";

// Lädt alle Module, die Freigabe-Arten registrieren (registerApprovalKind).
// Jede Stelle, die Freigaben entscheidet, importiert diese Datei zuerst.
// Neue Bereiche tragen hier ihre Registrierungsdatei ein.
import "./process/register";
import "./mcp-admin/approvals";
import "./lexware/approvals";
import "./documents/approvals";
import "./calendar/approvals";
import "./billing/approvals";
export {};

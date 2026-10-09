import "server-only";
import { definitionSchema, validateDefinition, type ObjectType, type ProcessDefinition, type ValidationResult } from "./definition";
import { checkReferences, type CatalogData } from "./fields";
import { loadCatalogData } from "./fields-server";

/**
 * Prüft, ob alle Felder, Werte und IDs der Definition im Sub-Account existieren
 * (Felder, eigene Felder, Listen, Phasen, Lifecycle, Vorlagen, Webhooks, Personen, Formulare).
 */
export async function validateReferences(workspaceId: string, objectType: ObjectType, def: ProcessDefinition, data?: CatalogData) {
  return checkReferences(data ?? (await loadCatalogData(workspaceId)), objectType, def);
}

/** Struktur- UND Referenzprüfung in einem Ergebnis (für Speichern, Veröffentlichen, MCP). */
export async function validateFull(workspaceId: string, objectType: ObjectType, input: unknown, data?: CatalogData): Promise<ValidationResult> {
  const base = validateDefinition(input, objectType);
  const parsed = definitionSchema.safeParse(input);
  // Unlesbare Definition: die Strukturprüfung meldet bereits Fehler, Referenzen wären nur Folgefehler
  if (!parsed.success) return base;
  const refIssues = await validateReferences(workspaceId, objectType, parsed.data, data);
  const issues = [...base.issues, ...refIssues];
  return { ok: !issues.some((i) => i.level === "error"), external: base.external, issues };
}

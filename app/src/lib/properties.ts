import "server-only";
import { db } from "./db";

// Eigene Felder (PropertyDefinition) für Kontakte; Brevo- und HubSpot-kompatibel.

export const PROPERTY_TYPES = ["text", "number", "date", "boolean", "select"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export function inferType(v: unknown): PropertyType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  return "text";
}

/** Fehlende Felddefinitionen anlegen (vorhandene bleiben unverändert). */
export async function ensureProperties(workspaceId: string, values: Record<string, unknown>, source: string) {
  const keys = Object.keys(values);
  if (!keys.length) return;
  await db.propertyDefinition.createMany({
    data: keys.map((key) => ({ workspaceId, objectType: "contact", key, label: key, type: inferType(values[key]), source })),
    skipDuplicates: true,
  });
}

export function listProperties(workspaceId: string) {
  return db.propertyDefinition.findMany({ where: { workspaceId, objectType: "contact" }, orderBy: { label: "asc" } });
}

/** Unser Feldtyp → Brevo-Attributtyp. */
export function toBrevoType(t: string): "text" | "float" | "date" | "boolean" | "category" {
  return t === "number" ? "float" : t === "date" ? "date" : t === "boolean" ? "boolean" : t === "select" ? "category" : "text";
}

/** Brevo-Attributtyp → unser Feldtyp. */
export function fromBrevoType(t: unknown): PropertyType {
  return t === "float" || t === "id" ? "number" : t === "date" ? "date" : t === "boolean" ? "boolean" : t === "category" ? "select" : "text";
}

/** Auswahl-Optionen normalisieren: [{ value, label }] */
export function parseOptions(raw: unknown): { value: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) =>
      typeof o === "string"
        ? { value: o, label: o }
        : o && typeof o === "object"
          ? { value: String((o as { value?: unknown }).value ?? ""), label: String((o as { label?: unknown }).label ?? (o as { value?: unknown }).value ?? "") }
          : null,
    )
    .filter((o): o is { value: string; label: string } => !!o && o.value !== "")
    .slice(0, 200);
}

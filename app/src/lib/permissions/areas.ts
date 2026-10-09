import type { Action, ObjectKey, Special } from "./catalog";

// Welche Berechtigung braucht ein Bereich (Reiter) im Sub-Account? Grundlage für Navigation und Bereichs-Layouts.
export type Need = { object: ObjectKey; action: Action } | { special: Special } | { anyOf: Need[] };

export const AREA_NEEDS: Record<string, Need> = {
  kontakte: { object: "contacts", action: "read" },
  unternehmen: { object: "companies", action: "read" },
  listen: { object: "lists", action: "read" },
  pipeline: { object: "deals", action: "read" },
  tickets: { object: "tickets", action: "read" },
  aufgaben: { object: "tasks", action: "read" },
  kalender: { object: "tasks", action: "read" },
  email: { object: "email", action: "read" },
  posteingang: { object: "email", action: "read" },
  formulare: { object: "forms", action: "read" },
  seiten: { object: "pages", action: "read" },
  analytics: { object: "analytics", action: "read" },
  kanaele: { object: "analytics", action: "read" },
  prozesse: { object: "processes", action: "read" },
  automationen: { object: "processes", action: "read" },
  rechnungen: { object: "invoices", action: "read" },
  abos: { object: "invoices", action: "read" },
  zahlungen: { object: "invoices", action: "read" },
  wissen: { object: "knowledge", action: "read" },
  wiki: { object: "knowledge", action: "read" },
  pflichten: { object: "compliance", action: "read" },
  api: { anyOf: [{ special: "manage_keys" }, { special: "view_audit" }, { object: "email", action: "read" }] },
  integrationen: { anyOf: [{ object: "invoices", action: "read" }, { special: "manage_settings" }] },
  erwaehnungen: { object: "companies", action: "read" },
  anreicherung: { anyOf: [{ object: "companies", action: "read" }, { object: "contacts", action: "read" }] },
  domains: { special: "manage_settings" },
  team: { special: "manage_users" },
  einstellungen: { special: "manage_settings" },
};

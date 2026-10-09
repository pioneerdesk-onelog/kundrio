import { z } from "zod";

// Berechtigungskatalog (Client und Server). Modell: Hybrid aus HubSpot-Reichweiten und Agentur-/Sub-Account-Rollen (Entscheidung 07.10.2026).
// Je Objekt: lesen / bearbeiten / löschen mit Reichweite none | own | team | all.
// Sonderrechte sind bewusst getrennt (z. B. Export ≠ Lesen, Schutz vor Datenabfluss).

export const SCOPES = ["none", "own", "team", "all"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { none: "keine", own: "eigene", team: "Team", all: "alle" };
const RANK: Record<Scope, number> = { none: 0, own: 1, team: 2, all: 3 };
export const scopeRank = (s: Scope) => RANK[s];

/**
 * Objekte. `owned: true` = Datensätze haben eine zuständige Person (ownerId) → Reichweite own/team möglich.
 * Für Objekte ohne Zuständige gilt own/team wie „none“ beim Schreiben bzw. „all“ beim Lesen ist nicht automatisch – siehe effectiveScope.
 */
export const OBJECTS = {
  contacts: { label: "Kontakte", owned: true },
  companies: { label: "Unternehmen", owned: true },
  deals: { label: "Deals", owned: true },
  tickets: { label: "Tickets", owned: true },
  tasks: { label: "Aufgaben & Kalender", owned: true },
  invoices: { label: "Angebote & Rechnungen", owned: false },
  email: { label: "E-Mail, Kampagnen & Vorlagen", owned: false },
  lists: { label: "Listen & eigene Felder", owned: false },
  forms: { label: "Formulare", owned: false },
  pages: { label: "Landingpages", owned: false },
  knowledge: { label: "Wissen & Wiki", owned: false },
  processes: { label: "Prozesse", owned: false },
  analytics: { label: "Analytics & Kanäle", owned: false },
  compliance: { label: "Pflichten", owned: false },
} as const;
export type ObjectKey = keyof typeof OBJECTS;
export const OBJECT_KEYS = Object.keys(OBJECTS) as ObjectKey[];

export const ACTIONS = ["read", "edit", "delete"] as const;
export type Action = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<Action, string> = { read: "lesen", edit: "bearbeiten", delete: "löschen" };

export const SPECIALS = {
  export: "Daten exportieren (CSV, ZIP, Wechsel)",
  import: "Daten importieren (CSV, Brevo, HubSpot)",
  approve: "Freigaben erteilen (Außenwirkung)",
  publish_processes: "Prozesse veröffentlichen",
  send_campaigns: "Kampagnen versenden",
  manage_keys: "API-, MCP- und Webhook-Zugänge verwalten",
  manage_settings: "Einstellungen & Branding des Sub-Accounts",
  manage_users: "Benutzer, Rollen und Teams verwalten",
  view_audit: "Audit- und MCP-Protokolle ansehen",
} as const;
export type Special = keyof typeof SPECIALS;
export const SPECIAL_KEYS = Object.keys(SPECIALS) as Special[];

const scopeSchema = z.enum(SCOPES);
const objectPermSchema = z.object({ read: scopeSchema, edit: scopeSchema, delete: scopeSchema });
export const permissionsSchema = z.object({
  objects: z.object(Object.fromEntries(OBJECT_KEYS.map((k) => [k, objectPermSchema])) as Record<ObjectKey, typeof objectPermSchema>),
  special: z.object(Object.fromEntries(SPECIAL_KEYS.map((k) => [k, z.boolean()])) as Record<Special, z.ZodBoolean>),
});
export type Permissions = z.infer<typeof permissionsSchema>;

// ---------- Vorlagen ----------

type ObjSpec = Partial<Record<ObjectKey, [Scope, Scope, Scope]>>;
function build(objects: ObjSpec, special: Special[]): Permissions {
  return {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((k) => {
        const [read, edit, del] = objects[k] ?? ["none", "none", "none"];
        return [k, { read, edit, delete: del }];
      }),
    ) as Permissions["objects"],
    special: Object.fromEntries(SPECIAL_KEYS.map((k) => [k, special.includes(k)])) as Permissions["special"],
  };
}
const ALL: [Scope, Scope, Scope] = ["all", "all", "all"];
const RW: [Scope, Scope, Scope] = ["all", "all", "none"];
const RO: [Scope, Scope, Scope] = ["all", "none", "none"];

export const PRESETS = {
  admin: {
    name: "Admin",
    description: "Alles im Sub-Account inkl. Benutzer, Schlüssel und Freigaben.",
    permissions: build(Object.fromEntries(OBJECT_KEYS.map((k) => [k, ALL])) as ObjSpec, [...SPECIAL_KEYS]),
  },
  teamleitung: {
    name: "Teamleitung",
    description: "Alle Daten bearbeiten, Prozesse ohne Außenwirkung veröffentlichen, Berichte, Export.",
    permissions: build(
      { contacts: ALL, companies: ALL, deals: ALL, tickets: ALL, tasks: ALL, invoices: RO, email: RW, lists: RW, forms: RW, pages: RW, knowledge: RW, processes: RW, analytics: RO, compliance: RO },
      ["export", "import", "publish_processes", "view_audit"],
    ),
  },
  vertrieb: {
    name: "Vertrieb",
    description: "Eigene und Team-Kontakte, -Unternehmen, -Deals und -Aufgaben.",
    permissions: build(
      { contacts: ["team", "own", "none"], companies: ["team", "own", "none"], deals: ["team", "own", "own"], tickets: ["team", "none", "none"], tasks: ["own", "own", "own"], invoices: ["all", "none", "none"], email: ["all", "none", "none"], lists: ["all", "none", "none"], knowledge: RO, processes: RO, analytics: RO },
      [],
    ),
  },
  service: {
    name: "Service",
    description: "Tickets bearbeiten, Kontakte und Unternehmen lesen.",
    permissions: build(
      { contacts: ["all", "own", "none"], companies: RO, deals: ["team", "none", "none"], tickets: ["all", "all", "none"], tasks: ["own", "own", "own"], knowledge: RW, processes: RO },
      [],
    ),
  },
  marketing: {
    name: "Marketing",
    description: "Listen, Kampagnen-Entwürfe, Landingpages, Formulare, Analytics.",
    permissions: build(
      { contacts: ["all", "all", "none"], companies: RO, deals: RO, email: RW, lists: ALL, forms: ALL, pages: ALL, knowledge: RW, processes: RO, analytics: RO },
      ["import"],
    ),
  },
  buchhaltung: {
    name: "Buchhaltung",
    description: "Angebote und Rechnungen, Kontakte und Unternehmen lesen.",
    permissions: build({ contacts: RO, companies: RO, deals: RO, invoices: RW }, ["export"]),
  },
  nurlesen: {
    name: "Nur lesen",
    description: "Alles ansehen, nichts ändern, kein Export.",
    permissions: build(Object.fromEntries(OBJECT_KEYS.map((k) => [k, RO])) as ObjSpec, []),
  },
} as const satisfies Record<string, { name: string; description: string; permissions: Permissions }>;
export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

/** Volle Rechte (Agentur-Inhaber/-Admin). */
export const FULL: Permissions = PRESETS.admin.permissions;

/** Gespeicherte Rechte tolerant lesen (fehlende Einträge = keine Rechte). */
export function parsePermissions(value: unknown): Permissions {
  const empty = build({}, []);
  const v = (value ?? {}) as Partial<Permissions>;
  const merged = {
    objects: Object.fromEntries(OBJECT_KEYS.map((k) => [k, { ...empty.objects[k], ...(v.objects?.[k] ?? {}) }])),
    special: { ...empty.special, ...(v.special ?? {}) },
  };
  const r = permissionsSchema.safeParse(merged);
  return r.success ? r.data : empty;
}

/** Schnittmenge zweier Rechte-Sätze (z. B. Benutzer ∩ OAuth-Scopes). */
export function intersect(a: Permissions, b: Permissions): Permissions {
  const min = (x: Scope, y: Scope) => (RANK[x] <= RANK[y] ? x : y);
  return {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((k) => [k, { read: min(a.objects[k].read, b.objects[k].read), edit: min(a.objects[k].edit, b.objects[k].edit), delete: min(a.objects[k].delete, b.objects[k].delete) }]),
    ) as Permissions["objects"],
    special: Object.fromEntries(SPECIAL_KEYS.map((k) => [k, a.special[k] && b.special[k]])) as Permissions["special"],
  };
}

/**
 * Prüft eine einzelne Aktion. `recordOwnerId` = Zuständige des Datensatzes (falls vorhanden),
 * `teamUserIds` = Benutzer, die mit dem Prüfenden ein Team teilen (inkl. ihm selbst).
 * Objekte ohne Zuständige: own/team gelten als „none“ (nur all erlaubt).
 */
export function allows(
  perms: Permissions,
  object: ObjectKey,
  action: Action,
  ctx: { userId: string; recordOwnerId?: string | null; teamUserIds?: string[] } = { userId: "" },
): boolean {
  const scope = perms.objects[object][action];
  if (scope === "all") return true;
  if (scope === "none") return false;
  if (!OBJECTS[object].owned) return false;
  // Ohne konkreten Datensatz (z. B. „darf überhaupt anlegen/sehen?“): own/team genügt
  if (ctx.recordOwnerId === undefined) return true;
  if (scope === "own") return ctx.recordOwnerId === ctx.userId || ctx.recordOwnerId === null;
  return ctx.recordOwnerId === null || ctx.recordOwnerId === ctx.userId || (ctx.teamUserIds ?? []).includes(ctx.recordOwnerId);
}

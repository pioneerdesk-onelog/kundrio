// Zuordnung zwischen Brevo-Attributen und unseren Kontaktfeldern. Reine Funktionen (testbar).

export type StdFields = { firstName?: string | null; lastName?: string | null; phone?: string | null; company?: string | null };
export type AttrValue = string | number | boolean | null;

/** Brevo-Standardattribute → unsere Felder. Weitere Namen gelten als eigene Felder. */
export const STANDARD_ATTRS: Record<string, keyof StdFields> = {
  FIRSTNAME: "firstName",
  VORNAME: "firstName",
  LASTNAME: "lastName",
  NACHNAME: "lastName",
  SMS: "phone",
  PHONE: "phone",
  TELEFON: "phone",
  COMPANY: "company",
  FIRMA: "company",
};

/** Brevo setzt bei Double-Opt-in-Formularen dieses Attribut. */
export const DOI_ATTRS = ["DOUBLE_OPT-IN", "DOUBLE_OPT_IN", "DOI"];

const KEY_RE = /^[A-Z0-9][A-Z0-9_-]{0,49}$/;

export function normalizeAttrKey(raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return KEY_RE.test(key) ? key : null;
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^@\s"<>]+@[^@\s"<>]+\.[^@\s"<>]{2,}$/.test(e)) return null;
  return e;
}

function toText(v: unknown, max = 2000): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim().slice(0, max) || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Wahrheitswert aus Brevo-Werten („1“, „Yes“, true, „ja“). Brevo-Kategorie DOI: 1 = Ja, 2 = Nein. */
export function isTruthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") return ["1", "true", "yes", "ja", "y", "x"].includes(v.trim().toLowerCase());
  return false;
}

/**
 * Brevo-Attribute aufteilen: Standardfelder und eigene Felder.
 * Unbekannte/ungültige Schlüssel und nicht-primitive Werte werden verworfen (in `rejected` gemeldet).
 */
export function splitBrevoAttributes(attributes: unknown, maxExtra = 100) {
  const fields: StdFields = {};
  const extra: Record<string, AttrValue> = {};
  const rejected: string[] = [];
  let doi = false;
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    for (const [rawKey, value] of Object.entries(attributes as Record<string, unknown>)) {
      const key = normalizeAttrKey(rawKey);
      if (!key) {
        rejected.push(rawKey);
        continue;
      }
      if (DOI_ATTRS.includes(key)) {
        doi = isTruthy(value);
        continue;
      }
      const std = STANDARD_ATTRS[key];
      if (std) {
        fields[std] = toText(value, 200);
        continue;
      }
      if (value !== null && typeof value === "object") {
        rejected.push(rawKey);
        continue;
      }
      if (Object.keys(extra).length >= maxExtra) {
        rejected.push(rawKey);
        continue;
      }
      extra[key] = typeof value === "string" ? value.slice(0, 2000) : (value as AttrValue);
    }
  }
  return { fields, extra, doi, rejected };
}

/** Unsere Kontaktdaten → Brevo-Attribute (für API-Antworten und Export). */
export function toBrevoAttributes(c: StdFields & { attributes?: unknown }): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  if (c.firstName) out.FIRSTNAME = c.firstName;
  if (c.lastName) out.LASTNAME = c.lastName;
  if (c.phone) out.SMS = c.phone;
  if (c.company) out.COMPANY = c.company;
  if (c.attributes && typeof c.attributes === "object" && !Array.isArray(c.attributes)) {
    for (const [k, v] of Object.entries(c.attributes as Record<string, unknown>)) {
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v as AttrValue;
    }
  }
  return out;
}

/** Paging-Parameter im Brevo-Stil (limit/offset) mit Grenzen. */
export function parsePaging(params: URLSearchParams, defLimit: number, maxLimit: number) {
  const rawLimit = Number(params.get("limit") ?? defLimit);
  const rawOffset = Number(params.get("offset") ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit) : defLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;
  const sort = params.get("sort") === "asc" ? ("asc" as const) : ("desc" as const);
  return { limit, offset, sort };
}

/** Brevo-Sperrgründe → unsere Suppression-Gründe. */
export function mapBlockReason(code: unknown): "hard_bounce" | "spam" | "unsubscribed" | "manual" {
  const c = String(code ?? "").toLowerCase();
  if (c.includes("bounce")) return "hard_bounce";
  if (c.includes("spam")) return "spam";
  if (c.includes("unsub")) return "unsubscribed";
  return "manual";
}

import type { Condition, ConditionGroup } from "./definition";

// Reine Bedingungsauswertung (ohne DB) – genutzt für Einschreibungsfilter, Wenn/Dann, Ziel, Warten-bis.

/** Zustand, gegen den Feldpfade aufgelöst werden: Objekte + Ereignisdaten + Kontext des Laufs. */
export type ProcessState = {
  contact?: Record<string, unknown> | null;
  company?: Record<string, unknown> | null;
  deal?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
};

/** Löst "contact.attributes.BRANCHE" bzw. "deal.stage.kind" auf. Unbekannt → undefined. */
export function getField(state: ProcessState, path: string): unknown {
  const [root, ...rest] = path.split(".");
  let cur: unknown = (state as Record<string, unknown>)[root];
  for (const key of rest) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (v instanceof Date) return v.getTime();
  return null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

function equals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return a.some((x) => equals(x, b));
  const na = toNumber(a);
  const nb = toNumber(b);
  if (typeof b === "number" && na !== null) return na === nb;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b);
  return norm(a instanceof Date ? a.toISOString() : a) === norm(b);
}

export function evalCondition(state: ProcessState, c: Condition, now = new Date()): boolean {
  const v = getField(state, c.field);
  switch (c.op) {
    case "is_set":
      return !isEmpty(v);
    case "is_not_set":
      return isEmpty(v);
    case "eq":
      return equals(v, c.value);
    case "neq":
      return !equals(v, c.value);
    case "contains":
    case "not_contains": {
      const needle = String(c.value ?? "").toLowerCase();
      const hit = Array.isArray(v)
        ? v.some((x) => String(x).toLowerCase() === needle)
        : typeof v === "string" && v.toLowerCase().includes(needle);
      return c.op === "contains" ? hit : !hit;
    }
    case "in": {
      const list = Array.isArray(c.value) ? c.value : String(c.value ?? "").split(",").map((s) => s.trim());
      return list.some((x) => equals(v, x));
    }
    case "gt":
    case "lt": {
      const a = toNumber(v);
      const b = toNumber(c.value);
      if (a === null || b === null) return false;
      return c.op === "gt" ? a > b : a < b;
    }
    case "days_ago_gt":
    case "days_ago_lt": {
      const d = toDate(v);
      const days = toNumber(c.value);
      if (!d || days === null) return false;
      const ago = (now.getTime() - d.getTime()) / 864e5;
      return c.op === "days_ago_gt" ? ago > days : ago < days;
    }
  }
}

/** Leere Gruppe = erfüllt. */
export function evalGroup(state: ProcessState, g: ConditionGroup | undefined | null, now = new Date()): boolean {
  if (!g || g.conditions.length === 0) return true;
  return g.match === "any" ? g.conditions.some((c) => evalCondition(state, c, now)) : g.conditions.every((c) => evalCondition(state, c, now));
}

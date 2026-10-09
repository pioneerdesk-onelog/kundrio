import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { log, errMessage } from "./log";

// Rate-Limits.
// - rateLimit():      im Speicher, nur für einen Prozess (Entwicklung, Tests).
// - rateLimitAsync(): mehrinstanzfähig über Postgres (Fenster-Zähler, UPSERT). In Produktion Standard.
//   Schlüssel werden gehasht gespeichert (enthalten teils E-Mail-Adressen/IPs).
//   Festes Zeitfenster: an Fenstergrenzen sind kurzzeitig bis zu 2× limit möglich – bewusst einfach gehalten.

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  return true;
}

function store(): "db" | "memory" {
  const s = process.env.RATE_LIMIT_STORE;
  if (s === "db" || s === "memory") return s;
  return process.env.NODE_ENV === "production" ? "db" : "memory";
}

export async function rateLimitAsync(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (store() === "memory") return rateLimit(key, limit, windowMs);
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  const hashed = createHash("sha256").update(key).digest("hex");
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "expiresAt")
      VALUES (${hashed}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    return Number(rows[0]?.count ?? 1) <= limit;
  } catch (e) {
    // DB-Störung: auf Speicher-Limit ausweichen statt alles zu blockieren oder alles zu erlauben
    log.warn("rate-limit db fallback", { error: errMessage(e) });
    return rateLimit(key, limit, windowMs);
  }
}

/** Abgelaufene Zähler löschen (Worker, stündlich). */
export async function cleanupRateLimits(): Promise<number> {
  const r = await db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}

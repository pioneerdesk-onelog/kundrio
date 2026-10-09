import { valueMatches } from "./records";
import type { CheckReport, DesiredRecord, RecordCheck } from "./types";

// Reine Auswertung der DNS-Beobachtungen (testbar ohne Netzwerk).

/** Beobachtungen: Resolver → "TYPE name" → gefundene Werte. */
export type Observations = Record<string, Record<string, string[]>>;

export const obsKey = (type: string, name: string) => `${type} ${name}`;

export function evaluate(
  desired: DesiredRecord[],
  obs: Observations,
  extra: { cnameChain?: string[]; flattened?: Record<string, boolean>; now?: Date } = {},
): CheckReport {
  const resolvers = Object.keys(obs);
  const records: RecordCheck[] = desired.map((d) => {
    const perResolver: Record<string, string[]> = {};
    let okResolvers = 0;
    for (const r of resolvers) {
      const found = obs[r][obsKey(d.type, d.name)] ?? [];
      perResolver[r] = found;
      const flat = d.type === "CNAME" && extra.flattened?.[r];
      if (found.some((f) => valueMatches(d, f)) || flat) okResolvers++;
    }
    const allFound = Array.from(new Set(Object.values(perResolver).flat()));
    // Mehrheit der Resolver entscheidet; „falsch“ = Werte vorhanden, aber keiner passt
    const ok = resolvers.length > 0 && okResolvers * 2 > resolvers.length;
    const status: RecordCheck["status"] = ok ? "ok" : allFound.length ? "wrong" : "missing";
    return { type: d.type, name: d.name, expected: d.value, purpose: d.purpose, status, found: allFound, perResolver, okResolvers, totalResolvers: resolvers.length };
  });

  let propagationOk = 0;
  for (const r of resolvers) {
    const allOk = desired.every((d) => {
      const found = obs[r][obsKey(d.type, d.name)] ?? [];
      return found.some((f) => valueMatches(d, f)) || (d.type === "CNAME" && extra.flattened?.[r]);
    });
    if (allOk) propagationOk++;
  }
  const ownership = records.filter((r) => r.purpose === "verify").every((r) => r.status === "ok");
  return {
    checkedAt: (extra.now ?? new Date()).toISOString(),
    records,
    ownership,
    cnameChain: extra.cnameChain ?? [],
    propagation: { ok: propagationOk, total: resolvers.length },
    allRequiredOk: records.every((r) => r.status === "ok"),
  };
}

/** Nächster Prüfzeitpunkt: 1, 2, 5, 10, 15, 30, 60 min, dann stündlich – bis 48 h nach Beginn. */
export function nextCheckDelayMs(attempt: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60];
  const min = attempt < steps.length ? steps[attempt] : 60;
  return min * 60_000;
}

export const VERIFY_WINDOW_MS = 48 * 3600_000;

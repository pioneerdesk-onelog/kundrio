// Reine Kostenrechnung (ohne DB) für das Kosten-Cockpit. Alle Beträge in Euro (Kommazahl),
// Ergebnisse zusätzlich in Cent. Fehlende Kostensätze zählen als 0 € und werden gemeldet.
import { z } from "zod";

export const AI_PROFILES = {
  local: "Lokal (Strom/GPU-Abschreibung)",
  stackit: "STACKIT AI Model Serving",
  infercom: "Infercom",
} as const;
export type AiProfile = keyof typeof AI_PROFILES;

const eur = z.number().min(0).max(1_000_000).nullable();
const aiRates = z.object({ inEurPer1M: eur, outEurPer1M: eur });

export const costRatesSchema = z.object({
  dbEurPerGbMonth: eur,
  objectEurPerGbMonth: eur,
  emailEurPer1000: eur,
  aiProfile: z.enum(["local", "stackit", "infercom"]),
  ai: z.object({ local: aiRates, stackit: aiRates, infercom: aiRates }),
  computeEurPerMonth: eur,
  backupEurPerMonth: eur,
  monitoringEurPerMonth: eur,
  /** Verteilung der Fixkosten: gleichmäßig je Sub-Account oder nach variablem Kostenanteil */
  fixedAllocation: z.enum(["equal", "usage"]),
});
export type CostRates = z.infer<typeof costRatesSchema>;

/** Startwerte: bewusst leer – Preise müssen beim Anbieter nachgeschlagen und eingetragen werden. */
export const DEFAULT_RATES: CostRates = {
  dbEurPerGbMonth: null,
  objectEurPerGbMonth: null,
  emailEurPer1000: null,
  aiProfile: "local",
  ai: {
    local: { inEurPer1M: null, outEurPer1M: null },
    stackit: { inEurPer1M: null, outEurPer1M: null },
    infercom: { inEurPer1M: null, outEurPer1M: null },
  },
  computeEurPerMonth: null,
  backupEurPerMonth: null,
  monitoringEurPerMonth: null,
  fixedAllocation: "equal",
};

/** Liest gespeicherte Sätze tolerant (fehlende Felder → Standard). */
export function parseRates(value: unknown): CostRates {
  const v = (value && typeof value === "object" ? value : {}) as Partial<CostRates>;
  const merged = {
    ...DEFAULT_RATES,
    ...v,
    ai: {
      local: { ...DEFAULT_RATES.ai.local, ...(v.ai?.local ?? {}) },
      stackit: { ...DEFAULT_RATES.ai.stackit, ...(v.ai?.stackit ?? {}) },
      infercom: { ...DEFAULT_RATES.ai.infercom, ...(v.ai?.infercom ?? {}) },
    },
  };
  const r = costRatesSchema.safeParse(merged);
  return r.success ? r.data : DEFAULT_RATES;
}

/** Messwerte, die für die Kostenrechnung relevant sind (Flüsse = letzte 30 Tage). */
export type CostInput = {
  dbBytes: number;
  objectBytes: number;
  emails30d: number;
  tokensIn30d: number;
  tokensOut30d: number;
  users: number;
};

export type CostBreakdown = {
  db: number;
  objects: number;
  email: number;
  aiIn: number;
  aiOut: number;
  variable: number;
  fixedShare: number;
  total: number;
  totalCents: number;
  perUser: number;
};

export const GB = 1024 ** 3;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Welche Sätze fehlen (zählen als 0 €)? Für Warnhinweise in der Oberfläche. */
export function missingRates(r: CostRates): string[] {
  const out: string[] = [];
  if (r.dbEurPerGbMonth == null) out.push("Datenbank €/GB-Monat");
  if (r.objectEurPerGbMonth == null) out.push("Objektspeicher €/GB-Monat");
  if (r.emailEurPer1000 == null) out.push("E-Mail-Relay €/1.000");
  const ai = r.ai[r.aiProfile];
  if (ai.inEurPer1M == null) out.push(`KI-Eingabe €/1 Mio. Tokens (${AI_PROFILES[r.aiProfile]})`);
  if (ai.outEurPer1M == null) out.push(`KI-Ausgabe €/1 Mio. Tokens (${AI_PROFILES[r.aiProfile]})`);
  if (r.computeEurPerMonth == null && r.backupEurPerMonth == null && r.monitoringEurPerMonth == null) out.push("Fixkosten Plattform");
  return out;
}

export function fixedTotal(r: CostRates): number {
  return (r.computeEurPerMonth ?? 0) + (r.backupEurPerMonth ?? 0) + (r.monitoringEurPerMonth ?? 0);
}

/** Variable Monatskosten eines Sub-Accounts (ohne Fixkostenanteil). */
export function variableCost(m: CostInput, r: CostRates) {
  const ai = r.ai[r.aiProfile];
  const db = (m.dbBytes / GB) * (r.dbEurPerGbMonth ?? 0);
  const objects = (m.objectBytes / GB) * (r.objectEurPerGbMonth ?? 0);
  const email = (m.emails30d / 1000) * (r.emailEurPer1000 ?? 0);
  const aiIn = (m.tokensIn30d / 1e6) * (ai.inEurPer1M ?? 0);
  const aiOut = (m.tokensOut30d / 1e6) * (ai.outEurPer1M ?? 0);
  return { db, objects, email, aiIn, aiOut, variable: db + objects + email + aiIn + aiOut };
}

/**
 * Kosten für alle Sub-Accounts inkl. Fixkostenanteil.
 * „usage“: Fixkosten nach variablem Anteil; sind alle variablen Kosten 0 → gleichmäßig.
 */
export function allocateCosts<K extends string>(items: { key: K; input: CostInput }[], r: CostRates): Record<K, CostBreakdown> {
  const vars = items.map((i) => ({ key: i.key, input: i.input, v: variableCost(i.input, r) }));
  const fixed = fixedTotal(r);
  const sumVar = vars.reduce((a, x) => a + x.v.variable, 0);
  const n = Math.max(1, vars.length);
  const out = {} as Record<K, CostBreakdown>;
  for (const x of vars) {
    const share = r.fixedAllocation === "usage" && sumVar > 0 ? x.v.variable / sumVar : 1 / n;
    const fixedShare = fixed * share;
    const total = x.v.variable + fixedShare;
    out[x.key] = {
      db: round2(x.v.db),
      objects: round2(x.v.objects),
      email: round2(x.v.email),
      aiIn: round2(x.v.aiIn),
      aiOut: round2(x.v.aiOut),
      variable: round2(x.v.variable),
      fixedShare: round2(fixedShare),
      total: round2(total),
      totalCents: Math.round(total * 100),
      perUser: round2(total / Math.max(1, x.input.users)),
    };
  }
  return out;
}

/**
 * Hochrechnung für Paketpreise: N Sub-Accounts mit je U Benutzern, deren Nutzung dem
 * gewählten Referenzprofil (Durchschnitt/Median/Maximum der gemessenen) entspricht.
 * Variable Kosten skalieren mit Sub-Accounts, Fixkosten bleiben gleich.
 */
export function projectCosts(reference: CostInput, r: CostRates, subAccounts: number, usersPerSubAccount: number) {
  const n = Math.max(1, Math.floor(subAccounts));
  const u = Math.max(1, Math.floor(usersPerSubAccount));
  const perWsVariable = variableCost(reference, r).variable;
  const fixed = fixedTotal(r);
  const total = perWsVariable * n + fixed;
  return {
    total: round2(total),
    perSubAccount: round2(total / n),
    perUser: round2(total / (n * u)),
    variablePerSubAccount: round2(perWsVariable),
    fixed: round2(fixed),
  };
}

/** Referenzprofil aus gemessenen Sub-Accounts. */
export function referenceInput(inputs: CostInput[], mode: "avg" | "median" | "max"): CostInput {
  const keys: (keyof CostInput)[] = ["dbBytes", "objectBytes", "emails30d", "tokensIn30d", "tokensOut30d", "users"];
  const out = { dbBytes: 0, objectBytes: 0, emails30d: 0, tokensIn30d: 0, tokensOut30d: 0, users: 1 } as CostInput;
  if (inputs.length === 0) return out;
  for (const k of keys) {
    const vals = inputs.map((i) => i[k]).sort((a, b) => a - b);
    if (mode === "max") out[k] = vals[vals.length - 1];
    else if (mode === "median") {
      const mid = Math.floor(vals.length / 2);
      out[k] = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    } else out[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return out;
}

/** CSV-Feld sicher (Formel-Injektion in Tabellenprogrammen verhindern). */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

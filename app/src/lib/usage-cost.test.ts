import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATES,
  GB,
  allocateCosts,
  csvCell,
  missingRates,
  parseRates,
  projectCosts,
  referenceInput,
  variableCost,
  type CostInput,
  type CostRates,
} from "./usage-cost";

const rates: CostRates = {
  ...DEFAULT_RATES,
  dbEurPerGbMonth: 0.5,
  objectEurPerGbMonth: 0.02,
  emailEurPer1000: 0.8,
  aiProfile: "stackit",
  ai: { ...DEFAULT_RATES.ai, stackit: { inEurPer1M: 0.4, outEurPer1M: 1.2 } },
  computeEurPerMonth: 60,
  backupEurPerMonth: 10,
  monitoringEurPerMonth: 10,
};

const input = (o: Partial<CostInput> = {}): CostInput => ({
  dbBytes: 2 * GB,
  objectBytes: 0,
  emails30d: 5000,
  tokensIn30d: 3_000_000,
  tokensOut30d: 1_000_000,
  users: 4,
  ...o,
});

describe("variableCost", () => {
  it("rechnet alle Bestandteile", () => {
    const v = variableCost(input(), rates);
    expect(v.db).toBeCloseTo(1.0);
    expect(v.email).toBeCloseTo(4.0);
    expect(v.aiIn).toBeCloseTo(1.2);
    expect(v.aiOut).toBeCloseTo(1.2);
    expect(v.variable).toBeCloseTo(7.4);
  });

  it("fehlende Sätze zählen als 0 und werden gemeldet", () => {
    expect(variableCost(input(), DEFAULT_RATES).variable).toBe(0);
    expect(missingRates(DEFAULT_RATES).length).toBeGreaterThanOrEqual(5);
    expect(missingRates(rates)).toEqual([]);
  });
});

describe("allocateCosts", () => {
  it("verteilt Fixkosten gleichmäßig", () => {
    const r = allocateCosts([{ key: "a", input: input() }, { key: "b", input: input({ emails30d: 0 }) }], rates);
    expect(r.a.fixedShare).toBe(40);
    expect(r.b.fixedShare).toBe(40);
    expect(r.a.total).toBeCloseTo(47.4);
    expect(r.a.totalCents).toBe(4740);
    expect(r.a.perUser).toBeCloseTo(11.85);
  });

  it("verteilt Fixkosten nach Nutzung", () => {
    const r = allocateCosts(
      [{ key: "a", input: input() }, { key: "b", input: input({ dbBytes: 0, emails30d: 0, tokensIn30d: 0, tokensOut30d: 0 }) }],
      { ...rates, fixedAllocation: "usage" },
    );
    expect(r.a.fixedShare).toBe(80);
    expect(r.b.fixedShare).toBe(0);
  });

  it("fällt bei „usage“ ohne variable Kosten auf gleichmäßig zurück", () => {
    const r = allocateCosts([{ key: "a", input: input() }, { key: "b", input: input() }], { ...DEFAULT_RATES, computeEurPerMonth: 100, fixedAllocation: "usage" });
    expect(r.a.fixedShare).toBe(50);
  });

  it("Kosten je Benutzer ohne Benutzer → durch 1 statt durch 0", () => {
    const r = allocateCosts([{ key: "a", input: input({ users: 0 }) }], rates);
    expect(Number.isFinite(r.a.perUser)).toBe(true);
  });
});

describe("projectCosts & referenceInput", () => {
  it("skaliert variable Kosten, Fixkosten bleiben", () => {
    const p = projectCosts(input(), rates, 10, 3);
    expect(p.total).toBeCloseTo(7.4 * 10 + 80);
    expect(p.perSubAccount).toBeCloseTo(15.4);
    expect(p.perUser).toBeCloseTo((74 + 80) / 30);
  });

  it("Median, Durchschnitt, Maximum", () => {
    const xs = [input({ emails30d: 100 }), input({ emails30d: 300 }), input({ emails30d: 1000 })];
    expect(referenceInput(xs, "median").emails30d).toBe(300);
    expect(referenceInput(xs, "avg").emails30d).toBeCloseTo(466.67, 1);
    expect(referenceInput(xs, "max").emails30d).toBe(1000);
    expect(referenceInput([], "avg").users).toBe(1);
  });
});

describe("parseRates & csvCell", () => {
  it("ergänzt fehlende Felder und verwirft Ungültiges", () => {
    expect(parseRates({ dbEurPerGbMonth: 1 }).dbEurPerGbMonth).toBe(1);
    expect(parseRates({ dbEurPerGbMonth: 1 }).ai.infercom.inEurPer1M).toBeNull();
    expect(parseRates({ dbEurPerGbMonth: -5 })).toEqual(DEFAULT_RATES);
    expect(parseRates(null)).toEqual(DEFAULT_RATES);
  });

  it("entschärft Formeln und quotet Trennzeichen", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell(-3)).toBe("-3");
  });
});

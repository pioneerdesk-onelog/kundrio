import { describe, expect, it } from "vitest";
import { drainEvents } from "./drain";

// Belastungstest 2026-10-07 (LR-1): Der Verteiler holte je 2-s-Takt höchstens 200 Ereignisse
// → Durchsatz fest bei ~100 Ereignissen/s, 5.000 Ereignisse brauchten ~51 s, ein Import mit 50.000 Kontakten ~8 min.
// Ein Takt muss deshalb weiterverteilen, solange volle Stapel zurückkommen (mit Zeitbudget).

const batch = (processed: number, started = 0, failed = 0) => ({ processed, started, failed });

describe("drainEvents", () => {
  it("verteilt weiter, solange volle Stapel kommen, und summiert", async () => {
    const results = [batch(200, 5), batch(200, 7), batch(200), batch(13, 1)];
    let calls = 0;
    const r = await drainEvents(async (limit) => {
      expect(limit).toBe(200);
      return results[calls++];
    }, { batch: 200, budgetMs: 60_000 });
    expect(calls).toBe(4);
    expect(r).toEqual({ processed: 613, started: 13, failed: 0, rounds: 4 });
  });

  it("hört beim ersten nicht vollen Stapel auf (leere Outbox = ein Aufruf)", async () => {
    let calls = 0;
    const r = await drainEvents(async () => (calls++, batch(0)), { batch: 200, budgetMs: 60_000 });
    expect(calls).toBe(1);
    expect(r.processed).toBe(0);
  });

  it("bricht nach dem Zeitbudget ab, damit der Worker Jobs und Stopp-Signale bedient", async () => {
    let now = 0;
    let calls = 0;
    const r = await drainEvents(
      async () => {
        calls++;
        now += 4_000;
        return batch(200);
      },
      { batch: 200, budgetMs: 10_000, clock: () => now },
    );
    expect(calls).toBe(3);
    expect(r.processed).toBe(600);
  });

  it("hört bei Fehlern im Stapel auf (kein Endlos-Wiederholen fehlerhafter Ereignisse)", async () => {
    let calls = 0;
    await drainEvents(async () => (calls++, batch(200, 0, 3)), { batch: 200, budgetMs: 60_000 });
    expect(calls).toBe(1);
  });

  it("bricht ab, wenn shouldStop meldet", async () => {
    let calls = 0;
    await drainEvents(async () => (calls++, batch(200)), { batch: 200, budgetMs: 60_000, shouldStop: () => calls >= 2 });
    expect(calls).toBe(2);
  });
});

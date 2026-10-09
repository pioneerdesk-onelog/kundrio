import { describe, expect, it } from "vitest";
import { runLoop } from "./worker-loop";

// Robustheitstest 2026-10-07 (LR-7): Ein kurzer Verbindungsabbruch der Datenbank (pg_terminate_backend) beendete
// den Worker („worker crashed“, Exit 1) – lokal riss `npm run dev:all` damit auch die App mit, in Produktion blieb
// der laufende Job bis zu 10 min gesperrt. Die Schleife muss Fehler protokollieren, kurz warten und weiterlaufen.

describe("runLoop", () => {
  it("überlebt Fehler einer Runde und macht nach einer Pause weiter", async () => {
    const seen: string[] = [];
    const sleeps: number[] = [];
    let n = 0;
    await runLoop(
      async () => {
        n++;
        if (n === 2) throw new Error("Server has closed the connection.");
        seen.push(`runde ${n}`);
        return n < 4 ? "busy" : "idle";
      },
      { shouldStop: () => n >= 4, sleep: async (ms) => void sleeps.push(ms), onError: (e) => seen.push(`fehler: ${(e as Error).message}`), idleMs: 1000, errorMs: 2000 },
    );
    expect(seen).toEqual(["runde 1", "fehler: Server has closed the connection.", "runde 3", "runde 4"]);
    expect(sleeps).toEqual([2000, 1000]);
  });

  it("wartet nur, wenn nichts zu tun war", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await runLoop(async () => (++n === 3 ? "idle" : "busy"), { shouldStop: () => n >= 3, sleep: async (ms) => void sleeps.push(ms), onError: () => {}, idleMs: 1000, errorMs: 2000 });
    expect(sleeps).toEqual([1000]);
  });
});

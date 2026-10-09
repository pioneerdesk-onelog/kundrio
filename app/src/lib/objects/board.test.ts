import { describe, expect, it } from "vitest";
import { BOARD_STAGE_LIMIT, boardColumns } from "./board";

// Belastungstest 2026-10-07 (LR-3): Die Pipeline lud ALLE Deals (auch alle gewonnenen/verlorenen) –
// 4.000 Deals = 5,7 MB HTML, ~1 s bis „load“ im Browser, linear wachsend. Je Spalte höchstens BOARD_STAGE_LIMIT
// Karten (die zuletzt hinzugefügten/verschobenen = höchste Position), Rest als „weitere“ zählen.

const deal = (stageId: string, position: number) => ({ id: `${stageId}-${position}`, stageId, position });

describe("boardColumns", () => {
  it("begrenzt je Spalte, zeigt die neuesten Karten in aufsteigender Reihenfolge und zählt den Rest", () => {
    const loadedDesc = {
      a: [deal("a", 9), deal("a", 8), deal("a", 7)],
      b: [deal("b", 1)],
    };
    const totals = [
      { stageId: "a", count: 250 },
      { stageId: "b", count: 1 },
    ];
    const r = boardColumns(["a", "b", "c"], loadedDesc, totals);
    expect(r.deals.map((d) => d.id)).toEqual(["a-7", "a-8", "a-9", "b-1"]);
    expect(r.hidden).toEqual({ a: 247, b: 0, c: 0 });
  });

  it("Grenze ist so gewählt, dass eine Spalte bedienbar bleibt", () => {
    expect(BOARD_STAGE_LIMIT).toBeGreaterThanOrEqual(50);
    expect(BOARD_STAGE_LIMIT).toBeLessThanOrEqual(200);
  });
});

import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { EXPORTED, NOT_EXPORTED } from "./export-coverage";

describe("Vollständigkeit des Sub-Account-Exports (Art. 20 DSGVO)", () => {
  const models = Prisma.dmmf.datamodel.models.map((m) => m.name);

  it("jedes Modell im Schema ist exportiert oder bewusst ausgenommen", () => {
    const undecided = models.filter((m) => !(m in EXPORTED) && !(m in NOT_EXPORTED));
    expect(undecided).toEqual([]);
  });

  it("keine Einträge für Modelle, die es nicht (mehr) gibt, und keine Doppelentscheidung", () => {
    expect(Object.keys(EXPORTED).filter((m) => !models.includes(m))).toEqual([]);
    expect(Object.keys(NOT_EXPORTED).filter((m) => !models.includes(m))).toEqual([]);
    expect(Object.keys(EXPORTED).filter((m) => m in NOT_EXPORTED)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("liefert leeres Ergebnis für leeren Text", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
  });

  it("lässt kurzen Text unverändert", () => {
    expect(chunkText("Hallo Welt")).toEqual(["Hallo Welt"]);
  });

  it("hält die Maximallänge ein und verliert keinen Absatz", () => {
    const paras = Array.from({ length: 40 }, (_, i) => `Absatz ${i} ` + "x".repeat(120));
    const chunks = chunkText(paras.join("\n\n"), 500, 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    for (let i = 0; i < 40; i++) expect(chunks.some((c) => c.includes(`Absatz ${i} `))).toBe(true);
  });

  it("schneidet überlange Absätze hart", () => {
    const chunks = chunkText("y".repeat(3000), 1000, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it("erzeugt keinen Abschnitt nur aus Überlappung", () => {
    const text = ["a".repeat(400), "b".repeat(400), "c".repeat(400)].join("\n\n");
    const chunks = chunkText(text, 900, 100);
    expect(chunks.at(-1)).toContain("c");
  });
});

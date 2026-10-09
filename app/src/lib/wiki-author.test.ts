import { describe, expect, it } from "vitest";
import { wikiAuthorLabel } from "./wiki-author";

describe("wikiAuthorLabel", () => {
  it("zeigt keine technische Modellkennung", () => {
    expect(wikiAuthorLabel("llm:qwen3.6:35b-a3b")).toBe("KI-Assistent (lokal)");
    expect(wikiAuthorLabel("llm:qwen3.6:35b-a3b")).not.toContain("qwen");
  });
  it("zeigt Menschen als Team", () => {
    expect(wikiAuthorLabel("mensch")).toBe("Team");
  });
});

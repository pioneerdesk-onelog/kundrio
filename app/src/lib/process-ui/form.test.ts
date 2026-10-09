import { describe, expect, it } from "vitest";
import { NODE_TYPE_KEYS, NODE_TYPES } from "@/lib/process/definition";
import { defaultConfigFor, fieldsFor } from "./form";

describe("Formular-Ableitung", () => {
  it("erkennt Feldarten aus den Knotenschemas", () => {
    const f = Object.fromEntries(fieldsFor("action.create_task").map((x) => [x.key, x]));
    expect(f.title.kind).toBe("text");
    expect(f.dueDays.kind).toBe("number");
    expect(f.dueDays.integer).toBe(true);
    expect(f.dueDays.defaultValue).toBe(1);
    expect(f.assignTo.kind).toBe("select");
    expect(f.assignTo.options).toEqual(["owner", "unassigned"]);
  });

  it("erkennt Feldpfade, Bedingungen und Listen", () => {
    expect(fieldsFor("action.set_property").map((x) => x.kind)).toEqual(["fieldPath", "value"]);
    expect(fieldsFor("logic.if")[0].kind).toBe("conditionGroup");
    const classify = Object.fromEntries(fieldsFor("ai.classify").map((x) => [x.key, x.kind]));
    expect(classify).toMatchObject({ input: "fieldPathList", categories: "stringList", target: "fieldPath" });
    const score = fieldsFor("ai.score").find((x) => x.key === "rules")!;
    expect(score.kind).toBe("objectList");
    expect(score.item?.map((x) => x.kind)).toEqual(["condition", "number"]);
    expect(fieldsFor("action.send_email").find((x) => x.key === "body")?.kind).toBe("textarea");
  });

  it("liefert Startkonfigurationen, die nur noch Pflicht-Texte brauchen", () => {
    for (const t of NODE_TYPE_KEYS) {
      const cfg = defaultConfigFor(t);
      const r = NODE_TYPES[t].config.safeParse(cfg);
      if (!r.success) {
        // Fehlen dürfen nur leere Pflicht-Texte bzw. -Listen, keine Strukturfehler
        for (const i of r.error.issues) expect(["too_small", "invalid_format", "invalid_type"]).toContain(i.code);
      }
    }
    expect(defaultConfigFor("logic.wait")).toEqual({ amount: 1, unit: "minutes" });
    expect(defaultConfigFor("logic.if")).toEqual({ match: "all", conditions: [] });
    expect(NODE_TYPES["action.associate_company"].config.safeParse(defaultConfigFor("action.associate_company")).success).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { emptyDefinition } from "@/lib/process/definition";
import { conditionText, nodeSummary, triggerSummary } from "./summary";

describe("Zusammenfassungen", () => {
  it("beschreibt Bedingungen lesbar", () => {
    expect(conditionText({ field: "contact.trustScore", op: "gt", value: 60 })).toBe("contact.trustScore größer als 60");
    expect(conditionText({ field: "contact.email", op: "is_set" })).toBe("contact.email ist gesetzt");
  });

  it("nutzt Beschriftungen aus dem Lookup", () => {
    const l = { label: (k: string, v: string) => (k === "lifecycle" && v === "mql" ? "Marketing-qualifiziert" : v) };
    expect(nodeSummary({ id: "a", type: "action.set_lifecycle", config: { stage: "mql", onlyForward: true }, position: { x: 0, y: 0 } }, l)).toBe("→ Marketing-qualifiziert (nur vorwärts)");
    expect(nodeSummary({ id: "w", type: "logic.wait", config: { amount: 2, unit: "days" }, position: { x: 0, y: 0 } })).toBe("2 Tage");
  });

  it("fasst den Auslöser zusammen", () => {
    const d = emptyDefinition("form.submitted");
    expect(triggerSummary(d).title).toBe("Formular wurde ausgefüllt");
    d.trigger.config = { formId: "f1" };
    d.enrollment.filters.conditions = [{ field: "contact.email", op: "is_set" }];
    expect(triggerSummary(d).summary).toBe("Formular: f1 – Nur wenn: contact.email ist gesetzt");
  });
});

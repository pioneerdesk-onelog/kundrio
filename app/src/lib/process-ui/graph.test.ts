import { describe, expect, it } from "vitest";
import { emptyDefinition, validateDefinition, type ProcessDefinition } from "@/lib/process/definition";
import { autoLayout, changedNodeIds, connect, deleteNode, insertNode, newNodeId, reachable, TRIGGER_ID } from "./graph";

function base(): ProcessDefinition {
  return emptyDefinition("form.submitted");
}

describe("insertNode", () => {
  it("fügt nach dem Auslöser ein und macht den Knoten zum Start", () => {
    const { def, id } = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "neu" } });
    expect(def.start).toBe(id);
    expect(def.edges).toContainEqual({ from: id, to: "ende", output: "next" });
    expect(validateDefinition(def).ok).toBe(true);
  });

  it("fügt zwischen zwei Knoten ein und hängt den Nachfolger um", () => {
    const r1 = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "a" } });
    let def = r1.def;
    const a = r1.id;
    const r = insertNode(def, { from: a, output: "next" }, "action.create_task", { config: { title: "Anrufen", dueDays: 1, assignTo: "owner" } });
    def = r.def;
    expect(def.edges).toContainEqual({ from: a, to: r.id, output: "next" });
    expect(def.edges).toContainEqual({ from: r.id, to: "ende", output: "next" });
    expect(def.edges.filter((e) => e.from === a)).toHaveLength(1);
  });

  it("hängt bei Wenn/Dann den bisherigen Nachfolger an den Ja-Zweig", () => {
    const { def, id } = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "logic.if");
    expect(def.edges).toContainEqual({ from: id, to: "ende", output: "yes" });
    expect(def.edges.some((e) => e.from === id && e.output === "no")).toBe(false);
  });

  it("entfernt beim Einfügen von „Ende“ den dahinterliegenden, nun unerreichbaren Teil", () => {
    const r2 = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "a" } });
    let def = r2.def;
    const a = r2.id;
    def = insertNode(def, { from: a, output: "next" }, "logic.end").def;
    expect(def.nodes.some((n) => n.id === "ende")).toBe(false);
    expect([...reachable(def)].length).toBe(def.nodes.length);
  });
});

describe("deleteNode", () => {
  it("verbindet Vorgänger und Nachfolger", () => {
    const r3 = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "a" } });
    let def = r3.def;
    const a = r3.id;
    const r = insertNode(def, { from: a, output: "next" }, "action.remove_tag", { config: { tag: "b" } });
    def = deleteNode(r.def, r.id);
    expect(def.edges).toContainEqual({ from: a, to: "ende", output: "next" });
    expect(def.nodes.find((n) => n.id === r.id)).toBeUndefined();
  });

  it("verschiebt den Start, wenn der Startknoten gelöscht wird", () => {
    const { def, id } = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "a" } });
    const after = deleteNode(def, id);
    expect(after.start).toBe("ende");
  });

  it("entfernt beim Löschen einer Verzweigung den Nein-Zweig, behält den Ja-Zweig", () => {
    const r4 = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "logic.if");
    let def = r4.def;
    const iff = r4.id;
    const no = insertNode(def, { from: iff, output: "no" }, "action.add_tag", { config: { tag: "kalt" } });
    def = deleteNode(no.def, iff);
    expect(def.start).toBe("ende");
    expect(def.nodes.find((n) => n.id === no.id)).toBeUndefined();
  });

  it("lässt nie einen leeren Prozess zurück", () => {
    const def = deleteNode(base(), "ende");
    expect(def.nodes.length).toBe(1);
    expect(def.nodes[0].type).toBe("logic.end");
    expect(def.start).toBe(def.nodes[0].id);
  });
});

describe("Layout und Vergleich", () => {
  it("ordnet Zweige nebeneinander und Ebenen untereinander an", () => {
    const r5 = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "logic.if");
    let def = r5.def;
    const iff = r5.id;
    const no = insertNode(def, { from: iff, output: "no" }, "action.add_tag", { config: { tag: "x" } });
    def = autoLayout(no.def);
    const p = Object.fromEntries(def.nodes.map((n) => [n.id, n.position]));
    expect(p.ende.y).toBeGreaterThan(p[iff].y);
    expect(p[no.id].y).toBe(p.ende.y);
    expect(p.ende.x).toBeLessThan(p[no.id].x); // ja links, nein rechts
  });

  it("findet geänderte Knoten", () => {
    const { def: active, id } = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "a" } });
    const draft = { ...active, nodes: active.nodes.map((n) => (n.id === id ? { ...n, config: { tag: "b" } } : n)) };
    expect([...changedNodeIds(draft, active)]).toEqual([id]);
    expect(changedNodeIds(active, active).size).toBe(0);
  });

  it("verbindet Zweige wieder", () => {
    const r6 = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "logic.if");
    let def = r6.def;
    const iff = r6.id;
    def = connect(def, iff, "no", "ende");
    expect(validateDefinition(def).ok).toBe(true);
  });

  it("vergibt eindeutige IDs", () => {
    const { def } = insertNode(base(), { from: TRIGGER_ID, output: "next" }, "action.add_tag", { config: { tag: "a" } });
    expect(newNodeId(def, "action.add_tag")).toBe("add_tag_2");
  });
});

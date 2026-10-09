import { describe, expect, it } from "vitest";
import { evalCondition, evalGroup, getField, type ProcessState } from "./conditions";
import { findNode, hasErrorEdge, nextNodeId } from "./graph";
import { causedBy, eventDepth, MAX_EVENT_DEPTH, mayTrigger } from "./loop-guard";
import { asData, extractJson, parseClassification, parseExtraction, parseScore } from "./ai-parse";
import { eventSubject, triggerMatches } from "./matching";
import { addWorkdays, resolveDate } from "./dates";
import { validateDefinition, type ProcessDefinition } from "./definition";
import { PROCESS_TEMPLATES } from "./templates";

const now = new Date("2026-10-07T12:00:00Z");
const state: ProcessState = {
  contact: {
    email: "a@firma.de",
    lifecycleStage: "lead",
    tags: ["Kunde", "VIP"],
    trustScore: 80,
    phone: "",
    attributes: { BRANCHE: "IT", LEAD_SCORE: 55 },
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  },
  deal: { stage: { kind: "OPEN" }, valueCents: 120000, updatedAt: "2026-09-20T00:00:00Z" },
  event: { formId: "f1" },
  context: { k1: { category: "Support" } },
};

describe("Bedingungen", () => {
  it("löst Feldpfade auf", () => {
    expect(getField(state, "contact.attributes.BRANCHE")).toBe("IT");
    expect(getField(state, "deal.stage.kind")).toBe("OPEN");
    expect(getField(state, "context.k1.category")).toBe("Support");
    expect(getField(state, "company.name")).toBeUndefined();
  });

  it("vergleicht ohne Groß/Klein und mit Zahlen", () => {
    expect(evalCondition(state, { field: "contact.lifecycleStage", op: "eq", value: "LEAD" })).toBe(true);
    expect(evalCondition(state, { field: "contact.attributes.LEAD_SCORE", op: "gt", value: 49 })).toBe(true);
    expect(evalCondition(state, { field: "contact.attributes.LEAD_SCORE", op: "lt", value: 49 })).toBe(false);
    expect(evalCondition(state, { field: "contact.trustScore", op: "eq", value: 80 })).toBe(true);
  });

  it("prüft Listen, Leere und Zeitabstände", () => {
    expect(evalCondition(state, { field: "contact.tags", op: "contains", value: "vip" })).toBe(true);
    expect(evalCondition(state, { field: "contact.tags", op: "not_contains", value: "x" })).toBe(true);
    expect(evalCondition(state, { field: "contact.lifecycleStage", op: "in", value: ["subscriber", "lead"] })).toBe(true);
    expect(evalCondition(state, { field: "contact.phone", op: "is_not_set" })).toBe(true);
    expect(evalCondition(state, { field: "contact.email", op: "is_set" })).toBe(true);
    expect(evalCondition(state, { field: "deal.updatedAt", op: "days_ago_gt", value: 14 }, now)).toBe(true);
    expect(evalCondition(state, { field: "deal.updatedAt", op: "days_ago_lt", value: 14 }, now)).toBe(false);
    expect(evalCondition(state, { field: "contact.updatedAt", op: "days_ago_gt", value: 30 }, now)).toBe(true);
  });

  it("wertet Gruppen aus (leer = erfüllt)", () => {
    expect(evalGroup(state, { match: "all", conditions: [] })).toBe(true);
    expect(
      evalGroup(state, { match: "any", conditions: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }, { field: "deal.stage.kind", op: "eq", value: "OPEN" }] }),
    ).toBe(true);
    expect(
      evalGroup(state, { match: "all", conditions: [{ field: "contact.lifecycleStage", op: "eq", value: "customer" }, { field: "deal.stage.kind", op: "eq", value: "OPEN" }] }),
    ).toBe(false);
  });
});

const def: ProcessDefinition = {
  schemaVersion: 1,
  trigger: { type: "form.submitted", config: { formId: "f1" } },
  enrollment: { filters: { match: "all", conditions: [] }, reenroll: false },
  start: "a",
  nodes: [
    { id: "a", type: "logic.if", config: { match: "all", conditions: [] }, position: { x: 0, y: 0 } },
    { id: "b", type: "action.add_tag", config: { tag: "x" }, position: { x: 0, y: 0 } },
    { id: "c", type: "logic.end", config: {}, position: { x: 0, y: 0 } },
  ],
  edges: [
    { from: "a", to: "b", output: "yes" },
    { from: "a", to: "c", output: "no" },
    { from: "b", to: "c", output: "next" },
    { from: "b", to: "c", output: "error" },
  ],
};

describe("Graph und Auslöser", () => {
  it("folgt Ausgängen", () => {
    expect(findNode(def, "b")?.type).toBe("action.add_tag");
    expect(nextNodeId(def, "a", "yes")).toBe("b");
    expect(nextNodeId(def, "a", "no")).toBe("c");
    expect(nextNodeId(def, "c", "next")).toBeNull();
    expect(hasErrorEdge(def, "b")).toBe(true);
    expect(hasErrorEdge(def, "a")).toBe(false);
  });

  it("prüft die Auslöser-Konfiguration", () => {
    expect(triggerMatches(def, { type: "form.submitted", data: { formId: "f1" } })).toBe(true);
    expect(triggerMatches(def, { type: "form.submitted", data: { formId: "f2" } })).toBe(false);
    expect(triggerMatches(def, { type: "contact.created", data: {} })).toBe(false);
    const stage = { ...def, trigger: { type: "deal.stage_changed" as const, config: { stageId: "s2" } } };
    expect(triggerMatches(stage, { type: "deal.stage_changed", data: { stageId: "s2", fromStageId: "s1" } })).toBe(true);
    expect(triggerMatches(stage, { type: "deal.stage_changed", data: { stageId: "s3" } })).toBe(false);
    const bounce = { ...def, trigger: { type: "email.event" as const, config: { event: "hard_bounce" } } };
    expect(triggerMatches(bounce, { type: "email.event", data: { event: "hard_bounce" } })).toBe(true);
    expect(triggerMatches(bounce, { type: "email.event", data: { event: "click" } })).toBe(false);
    const prop = { ...def, trigger: { type: "contact.property_changed" as const, config: { field: "attributes.LEAD_SCORE" } } };
    expect(triggerMatches(prop, { type: "contact.property_changed", data: { field: "attributes.lead_score" } })).toBe(true);
  });

  it("ignoriert Import-Ereignisse, außer ausdrücklich erlaubt", () => {
    const created = { ...def, trigger: { type: "contact.created" as const, config: {} } };
    expect(triggerMatches(created, { type: "contact.created", data: {} })).toBe(true);
    expect(triggerMatches(created, { type: "contact.created", data: { import: true } })).toBe(false);
    expect(triggerMatches(created, { type: "contact.created", data: { import: false } })).toBe(true);
    const withImports = { ...def, trigger: { type: "contact.created" as const, config: { includeImports: true } } };
    expect(triggerMatches(withImports, { type: "contact.created", data: { import: true } })).toBe(true);
    // gilt auch für andere Auslöser mit Konfiguration
    expect(triggerMatches(def, { type: "form.submitted", data: { formId: "f1", import: true } })).toBe(false);
  });

  it("erkennt Schleifen bei der Prüfung", () => {
    const loop = { ...def, edges: [...def.edges.filter((e) => e.from !== "b"), { from: "b", to: "a", output: "next" }] };
    const v = validateDefinition(loop);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.includes("Schleife"))).toBe(true);
  });
});

describe("Schleifenschutz", () => {
  it("verhindert Selbstauslösung und begrenzt die Tiefe", () => {
    expect(mayTrigger("p1", causedBy("p1", "r1", 0)).ok).toBe(false);
    expect(mayTrigger("p2", causedBy("p1", "r1", 0)).ok).toBe(true);
    expect(mayTrigger("p2", { depth: MAX_EVENT_DEPTH }).ok).toBe(false);
    expect(mayTrigger("p2", {}).ok).toBe(true);
    expect(eventDepth(causedBy("p1", "r1", 2))).toBe(3);
    expect(eventDepth(null)).toBe(0);
  });
});

describe("KI-Antworten", () => {
  it("holt JSON auch aus Codeblöcken und Denkblöcken", () => {
    expect(extractJson('<think>hm</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Antwort: {"a": {"b": 2}} fertig')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("kein json")).toThrow();
  });

  it("akzeptiert nur erlaubte Kategorien", () => {
    expect(parseClassification('{"category":"support","confidence":0.9}', ["Angebot", "Support"])).toMatchObject({ category: "Support", confidence: 0.9 });
    expect(parseClassification('{"category":"Hack","confidence":0.99}', ["Angebot", "Support"]).category).toBeNull();
    expect(parseClassification('{"category":"Support","confidence":"abc"}', ["Support"]).confidence).toBe(0);
  });

  it("wandelt ausgelesene Werte typgerecht", () => {
    const r = parseExtraction('{"fields":{"MITARBEITER":"25","START":"2026-11-01","DRINGEND":"ja","NOTIZ":"x","LEER":""},"confidence":0.8}', [
      { key: "MITARBEITER", type: "number" },
      { key: "START", type: "date" },
      { key: "DRINGEND", type: "boolean" },
      { key: "NOTIZ", type: "text" },
      { key: "LEER", type: "text" },
      { key: "FEHLT", type: "text" },
    ]);
    expect(r.values).toEqual({ MITARBEITER: 25, START: "2026-11-01", DRINGEND: true, NOTIZ: "x" });
  });

  it("begrenzt KI-Punkte und säubert Eingaben", () => {
    expect(parseScore('{"points":99,"reason":"x"}').points).toBe(0);
    expect(parseScore('{"points":12,"reason":"gut"}')).toEqual({ points: 12, reason: "gut" });
    expect(asData("a\u0000b", 10)).toBe("a b");
    expect(asData("x".repeat(50), 10)).toHaveLength(10);
  });
});

describe("Relative Datumsangaben", () => {
  it("rechnet now±N h/d", () => {
    expect(resolveDate("now+24h", now)?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(resolveDate("now-2d", now)?.toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(resolveDate("2026-12-01", now)?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(resolveDate("unsinn", now)).toBeNull();
  });
});

describe("Best-Practice-Vorlagen", () => {
  it.each(PROCESS_TEMPLATES.map((t) => [t.key, t] as const))("%s ist gültig", (_k, t) => {
    const v = validateDefinition(t.definition, t.objectType);
    expect(v.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(v.issues.filter((i) => i.level === "warning")).toEqual([]);
  });

  it("Vorlagen mit E-Mail, WhatsApp/SMS, Belegversand oder Termin sind als Außenwirkung markiert, die übrigen nicht", () => {
    const ext = PROCESS_TEMPLATES.filter((t) => validateDefinition(t.definition).external).map((t) => t.key).sort();
    expect(ext).toEqual(["ab-kickoff-termin", "angebot-angenommen-ab", "eingangsbestaetigung", "termin-gebucht-vorbereitung", "willkommen-kunde"]);
  });
});

describe("Beleg-Ereignisse → Kontakt", () => {
  it("bildet invoice-Ereignisse auf den Kontakt ab und gibt Beleg-IDs mit", () => {
    expect(eventSubject({ type: "quote.accepted", objectType: "invoice", objectId: "q1", data: { contactId: "c1" } })).toEqual({ objectType: "contact", objectId: "c1", extra: { invoiceId: "q1", quoteId: "q1" } });
    expect(eventSubject({ type: "order.created", objectType: "invoice", objectId: "o1", data: { contactId: "c1", quoteId: "q1" } })?.extra).toEqual({ invoiceId: "o1", orderId: "o1" });
    expect(eventSubject({ type: "invoice.sent", objectType: "invoice", objectId: "r1", data: { contactId: "c1", kind: "INVOICE" } })?.extra).toEqual({ invoiceId: "r1" });
  });
  it("ohne Kontakt wird nichts eingeschrieben", () => {
    expect(eventSubject({ type: "quote.accepted", objectType: "invoice", objectId: "q1", data: {} })).toBeNull();
  });
  it("andere Ereignisse bleiben unverändert", () => {
    expect(eventSubject({ type: "form.submitted", objectType: "contact", objectId: "c1", data: {} })).toEqual({ objectType: "contact", objectId: "c1", extra: {} });
  });
  it("Auslöser-Filter für Belegart und Terminvorlage", () => {
    const d = (type: "invoice.sent" | "meeting.scheduled", config: Record<string, unknown>) => ({ ...PROCESS_TEMPLATES[0].definition, trigger: { type, config } });
    expect(triggerMatches(d("invoice.sent", { kind: "INVOICE" }), { type: "invoice.sent", data: { kind: "INVOICE" } })).toBe(true);
    expect(triggerMatches(d("invoice.sent", { kind: "INVOICE" }), { type: "invoice.sent", data: { kind: "ORDER" } })).toBe(false);
    expect(triggerMatches(d("meeting.scheduled", { meetingTypeId: "m1" }), { type: "meeting.scheduled", data: { meetingTypeId: "m2" } })).toBe(false);
  });
  it("Rechnung bezahlt: Kontakt der Rechnung, optional nur ein Zahlweg", () => {
    expect(eventSubject({ type: "invoice.paid", objectType: "invoice", objectId: "r1", data: { contactId: "c1", via: "online" } })).toEqual({ objectType: "contact", objectId: "c1", extra: { invoiceId: "r1" } });
    const d = (config: Record<string, unknown>) => ({ ...PROCESS_TEMPLATES[0].definition, trigger: { type: "invoice.paid" as const, config } });
    expect(triggerMatches(d({}), { type: "invoice.paid", data: { via: "manual" } })).toBe(true);
    expect(triggerMatches(d({ via: "online" }), { type: "invoice.paid", data: { via: "online" } })).toBe(true);
    expect(triggerMatches(d({ via: "online" }), { type: "invoice.paid", data: { via: "bank" } })).toBe(false);
    const tpl = PROCESS_TEMPLATES.find((t) => t.key === "rechnung-bezahlt-danke");
    expect(tpl?.definition.trigger.type).toBe("invoice.paid");
    expect(validateDefinition(tpl!.definition).ok).toBe(true);
  });
});

describe("Werktage", () => {
  it("überspringt Wochenenden", () => {
    const fri = new Date("2026-10-09T10:00:00Z"); // Freitag
    expect(addWorkdays(fri, 1).getUTCDay()).toBe(1); // Montag
    expect(addWorkdays(fri, 3).getUTCDay()).toBe(3); // Mittwoch
  });
});

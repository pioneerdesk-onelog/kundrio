import { describe, expect, it } from "vitest";
import type { ProcessDefinition } from "./definition";
import { availableFields, checkReferences, objectsFor, opsFor, writableFields, type CatalogData } from "./fields";
import { PROCESS_TEMPLATES, TEMPLATE_PROPERTIES } from "./templates";

const data: CatalogData = {
  properties: [
    { key: "BRANCHE", label: "Branche", objectType: "contact", type: "select", options: ["IT", "Handel"] },
    { key: "BUDGET", label: "Budget", objectType: "contact", type: "number" },
    ...TEMPLATE_PROPERTIES.map((p) => ({ key: p.key, label: p.label, objectType: p.objectType, type: p.type, options: p.options })),
  ],
  lifecycleStages: ["subscriber", "lead", "mql", "sql", "opportunity", "customer", "evangelist", "other"].map((k) => ({ value: k, label: k })),
  stages: [
    { value: "st-neu", label: "Vertrieb · Neu", objectType: "deal", kind: "OPEN" },
    { value: "st-won", label: "Vertrieb · Gewonnen", objectType: "deal", kind: "WON" },
    { value: "tk-neu", label: "Support · Neu", objectType: "ticket", kind: "OPEN" },
  ],
  lists: [{ value: "list-1", label: "Newsletter" }],
  users: [{ value: "u1", label: "Marcus" }],
  forms: [{ value: "form-1", label: "Kontakt" }],
  templates: [{ value: "7", label: "Willkommen (#7)" }],
  webhooks: [],
  tags: ["vip"],
  meetingTypes: [{ value: "mt-kickoff", label: "Onboarding-Kickoff (45 min)" }],
};

/** Platzhalter der Vorlagen wie beim Anlegen auflösen (Terminvorlage per Name → ID). */
const resolved = (d: ProcessDefinition): ProcessDefinition => JSON.parse(JSON.stringify(d).replaceAll('"meetingType:Onboarding-Kickoff"', '"mt-kickoff"'));

function def(partial: Partial<ProcessDefinition>): ProcessDefinition {
  return {
    schemaVersion: 1,
    trigger: { type: "form.submitted", config: {} },
    enrollment: { filters: { match: "all", conditions: [] }, reenroll: false },
    start: "a",
    nodes: [{ id: "a", type: "logic.end", config: {}, position: { x: 0, y: 0 } }],
    edges: [],
    ...partial,
  };
}
const errors = (d: ProcessDefinition, ot: "contact" | "deal" | "ticket" | "company" = "contact") => checkReferences(data, ot, d).filter((i) => i.level === "error");

describe("Feld-Katalog", () => {
  it("Prozesse sehen die verknüpften Objekte wie die Engine", () => {
    expect(objectsFor("deal")).toEqual(["deal", "contact", "company"]);
    expect(objectsFor("company")).toEqual(["company"]);
  });
  it("enthält eigene Felder mit Typ und Optionen", () => {
    const f = availableFields(data, "contact", def({}), { kind: "trigger" }).find((x) => x.path === "contact.attributes.BRANCHE");
    expect(f?.type).toBe("select");
    expect(f?.options?.map((o) => o.value)).toEqual(["IT", "Handel"]);
  });
  it("Ereignisdaten nur für den gewählten Auslöser", () => {
    const fs = availableFields(data, "contact", def({}), { kind: "trigger" }).map((x) => x.path);
    expect(fs).toContain("event.formId");
    expect(fs).not.toContain("event.stageId");
  });
  it("beschreibbar sind nur freigegebene Kernfelder und eigene Felder", () => {
    const w = writableFields(data, "contact").map((x) => x.path);
    expect(w).toContain("contact.firstName");
    expect(w).toContain("contact.attributes.BUDGET");
    expect(w).not.toContain("contact.email");
    expect(w).not.toContain("contact.createdAt");
  });
});

describe("Vergleiche je Typ", () => {
  const fs = availableFields(data, "deal", def({ trigger: { type: "deal.stage_changed", config: {} } }), { kind: "trigger" });
  const get = (p: string) => fs.find((f) => f.path === p)!;
  it("Datum nur mit Tage-Vergleich und gesetzt/leer", () => expect(opsFor(get("deal.closedAt"))).toEqual(["days_ago_gt", "days_ago_lt", "is_set", "is_not_set"]));
  it("Zahl mit größer/kleiner, Text ohne", () => {
    expect(opsFor(get("deal.valueCents"))).toContain("gt");
    expect(opsFor(get("deal.title"))).not.toContain("gt");
  });
  it("Verweis ohne Auswahlliste nur gesetzt/leer", () => expect(opsFor(get("contact.companyId"))).toEqual(["is_set", "is_not_set"]));
});

describe("Referenzprüfung", () => {
  it("alle Best-Practice-Vorlagen bestehen", () => {
    for (const t of PROCESS_TEMPLATES) expect(errors(resolved(t.definition), t.objectType), t.key).toEqual([]);
  });
  it("fehlende/fremde Liste, Formular, Phase, Vorlage werden erkannt", () => {
    const d = def({
      trigger: { type: "form.submitted", config: { formId: "fremd" } },
      start: "l",
      nodes: [
        { id: "l", type: "action.add_to_list", config: { listId: "fremde-liste" }, position: { x: 0, y: 0 } },
        { id: "m", type: "action.send_email", config: { mode: "transactional", templateId: 99 }, position: { x: 0, y: 0 } },
        { id: "e", type: "logic.end", config: {}, position: { x: 0, y: 0 } },
      ],
      edges: [
        { from: "l", to: "m", output: "next" },
        { from: "m", to: "e", output: "next" },
      ],
    });
    const msgs = errors(d).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/Formular existiert nicht/);
    expect(msgs).toMatch(/Liste existiert nicht/);
    expect(msgs).toMatch(/Vorlage #99/);
  });
  it("Kontextwert ohne vorherigen KI-Schritt ist ein Fehler, mit KI-Schritt davor ok", () => {
    const cond = { field: "context.ki.category", op: "eq" as const, value: "Support" };
    const ohne = def({ start: "w", nodes: [{ id: "w", type: "logic.if", config: { match: "all", conditions: [cond] }, position: { x: 0, y: 0 } }] });
    expect(errors(ohne).map((i) => i.message).join()).toMatch(/keinem vorherigen KI-Schritt/);
    const mit = def({
      start: "ki",
      nodes: [
        { id: "ki", type: "ai.classify", config: { input: ["contact.lastActivityText"], categories: ["Angebot", "Termin", "Support", "Sonstiges"], target: "contact.attributes.ANLIEGEN", minConfidence: 0.7, onLowConfidence: "review_task" }, position: { x: 0, y: 0 } },
        { id: "w", type: "logic.if", config: { match: "all", conditions: [cond] }, position: { x: 0, y: 0 } },
      ],
      edges: [{ from: "ki", to: "w", output: "next" }],
    });
    expect(errors(mit)).toEqual([]);
  });
  it("gelöschtes eigenes Feld fällt auf", () => {
    const d = def({ enrollment: { filters: { match: "all", conditions: [{ field: "contact.attributes.GELOESCHT", op: "is_set" }] }, reenroll: false } });
    expect(errors(d).map((i) => i.message).join()).toMatch(/GELOESCHT/);
  });
  it("Wert außerhalb der Auswahl und unpassender Vergleich werden erkannt", () => {
    const d = def({
      enrollment: {
        filters: {
          match: "all",
          conditions: [
            { field: "contact.attributes.BRANCHE", op: "eq", value: "Bau" },
            { field: "contact.createdAt", op: "gt", value: 3 },
          ],
        },
        reenroll: false,
      },
    });
    const msgs = errors(d).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/„Bau“ ist für/);
    expect(msgs).toMatch(/passt nicht zu/);
  });
  it("„Eigenschaft setzen“ nur auf beschreibbare Felder; KI-Kategorien müssen Werte des Ziels sein", () => {
    const d = def({
      start: "s",
      nodes: [
        { id: "s", type: "action.set_property", config: { field: "contact.email", value: "x" }, position: { x: 0, y: 0 } },
        { id: "k", type: "ai.classify", config: { input: ["contact.notes"], categories: ["IT", "Bau"], target: "contact.attributes.BRANCHE", minConfidence: 0.7, onLowConfidence: "skip" }, position: { x: 0, y: 0 } },
      ],
      edges: [{ from: "s", to: "k", output: "next" }],
    });
    const msgs = errors(d).map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/nicht beschreibbar/);
    expect(msgs).toMatch(/„Bau“ sind keine Werte/);
  });
  it("Ticket-Phase in Deal-Prozess wird abgelehnt", () => {
    const d = def({ trigger: { type: "deal.stage_changed", config: { stageId: "tk-neu" } } });
    expect(errors(d, "deal").map((i) => i.message).join()).toMatch(/Phase existiert nicht/);
  });
});

describe("Belege & Termine", () => {
  const orderFlow = (send: Record<string, unknown>, trigger: ProcessDefinition["trigger"]["type"] = "quote.accepted", withOrderStep = true): ProcessDefinition =>
    def({
      trigger: { type: trigger, config: {} },
      start: withOrderStep ? "ab" : "send",
      nodes: [
        ...(withOrderStep ? [{ id: "ab", type: "action.create_order_confirmation" as const, config: { quoteSource: "event" }, position: { x: 0, y: 0 } }] : []),
        { id: "send", type: "action.send_document", config: send, position: { x: 0, y: 0 } },
        { id: "e", type: "logic.end", config: {}, position: { x: 0, y: 0 } },
      ],
      edges: [...(withOrderStep ? [{ from: "ab", to: "send", output: "next" }] : []), { from: "send", to: "e", output: "next" }],
    });

  it("AB senden nach „AB erstellen“ ist gültig", () => {
    expect(errors(orderFlow({ document: "order", withAcceptLink: false }))).toEqual([]);
  });
  it("Rechnung senden ohne vorherige Rechnung und ohne passenden Auslöser ist ein Fehler", () => {
    expect(errors(orderFlow({ document: "invoice", withAcceptLink: false }, "form.submitted", false)).map((i) => i.message).join(" ")).toMatch(/Kein Beleg verfügbar/);
  });
  it("Beleg des Ereignisses nur mit Beleg-Auslöser", () => {
    expect(errors(orderFlow({ document: "event", withAcceptLink: false }, "invoice.sent", false))).toEqual([]);
    expect(errors(orderFlow({ document: "event", withAcceptLink: false }, "form.submitted", false)).length).toBeGreaterThan(0);
  });
  it("Belege brauchen einen Kontakt (nicht in Unternehmens-Prozessen)", () => {
    const d = def({ trigger: { type: "company.created", config: {} }, start: "ab", nodes: [{ id: "ab", type: "action.create_order_confirmation", config: { quoteSource: "latest_accepted" }, position: { x: 0, y: 0 } }, { id: "e", type: "logic.end", config: {}, position: { x: 0, y: 0 } }], edges: [{ from: "ab", to: "e", output: "next" }] });
    expect(errors(d, "company").map((i) => i.message).join(" ")).toMatch(/Kontakt/);
  });
  it("Terminvorlage muss im Sub-Account existieren", () => {
    const mk = (id: string) => def({ start: "m", nodes: [{ id: "m", type: "action.schedule_meeting", config: { meetingTypeId: id, afterWorkdays: 2 }, position: { x: 0, y: 0 } }, { id: "e", type: "logic.end", config: {}, position: { x: 0, y: 0 } }], edges: [{ from: "m", to: "e", output: "next" }] });
    expect(errors(mk("mt-kickoff"))).toEqual([]);
    expect(errors(mk("fremd")).map((i) => i.message).join(" ")).toMatch(/Terminvorlage/);
  });
  it("Ereignisfelder der Beleg-Auslöser sind verfügbar", () => {
    const paths = availableFields(data, "contact", def({ trigger: { type: "quote.accepted", config: {} } }), { kind: "trigger" }).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["event.number", "event.grossCents", "event.via"]));
  });
});

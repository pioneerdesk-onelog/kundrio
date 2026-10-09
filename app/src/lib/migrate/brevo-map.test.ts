import { describe, expect, it } from "vitest";
import { isTruthy, mapBlockReason, normalizeAttrKey, normalizeEmail, parsePaging, splitBrevoAttributes, toBrevoAttributes } from "./brevo-map";

describe("splitBrevoAttributes", () => {
  it("ordnet Standardattribute zu und behält eigene Felder", () => {
    const r = splitBrevoAttributes({ FIRSTNAME: " Erika ", lastname: "Muster", SMS: "+49 151 1234", COMPANY: "ACME", TENANT_ID: "t1", MSP: "JA" });
    expect(r.fields).toEqual({ firstName: "Erika", lastName: "Muster", phone: "+49 151 1234", company: "ACME" });
    expect(r.extra).toEqual({ TENANT_ID: "t1", MSP: "JA" });
    expect(r.doi).toBe(false);
  });

  it("erkennt Double-Opt-in nur bei ausdrücklichem Wert", () => {
    expect(splitBrevoAttributes({ "DOUBLE_OPT-IN": "1" }).doi).toBe(true);
    expect(splitBrevoAttributes({ "DOUBLE_OPT-IN": 2 }).doi).toBe(false);
    expect(splitBrevoAttributes({ "DOUBLE_OPT-IN": "Yes" }).doi).toBe(true);
    expect(splitBrevoAttributes({}).doi).toBe(false);
  });

  it("verwirft ungültige Schlüssel, Objekte und zu viele Felder", () => {
    const r = splitBrevoAttributes({ "bad key!": "x", NESTED: { a: 1 }, A: 1, B: 2, C: 3 }, 2);
    expect(r.rejected).toEqual(["bad key!", "NESTED", "C"]);
    expect(Object.keys(r.extra)).toEqual(["A", "B"]);
  });

  it("ignoriert Nicht-Objekte", () => {
    expect(splitBrevoAttributes(null).extra).toEqual({});
    expect(splitBrevoAttributes(["x"]).extra).toEqual({});
  });
});

describe("toBrevoAttributes", () => {
  it("baut Brevo-Attribute aus Feldern und eigenen Feldern", () => {
    expect(toBrevoAttributes({ firstName: "A", lastName: null, phone: "1", company: "C", attributes: { X: 1, Y: { z: 1 } } })).toEqual({
      FIRSTNAME: "A",
      SMS: "1",
      COMPANY: "C",
      X: 1,
    });
  });
});

describe("Hilfsfunktionen", () => {
  it("normalisiert Schlüssel und E-Mails", () => {
    expect(normalizeAttrKey("tenant id")).toBe("TENANT_ID");
    expect(normalizeAttrKey("ä")).toBeNull();
    expect(normalizeEmail(" Max@Example.COM ")).toBe("max@example.com");
    expect(normalizeEmail("kein-at")).toBeNull();
    expect(isTruthy("ja")).toBe(true);
    expect(isTruthy("0")).toBe(false);
  });

  it("begrenzt Paging", () => {
    expect(parsePaging(new URLSearchParams("limit=5000&offset=-3"), 50, 1000)).toEqual({ limit: 1000, offset: 0, sort: "desc" });
    expect(parsePaging(new URLSearchParams("limit=abc&sort=asc"), 50, 1000)).toEqual({ limit: 50, offset: 0, sort: "asc" });
    expect(parsePaging(new URLSearchParams("limit=0&offset=20"), 10, 50)).toEqual({ limit: 1, offset: 20, sort: "desc" });
  });

  it("übersetzt Sperrgründe", () => {
    expect(mapBlockReason("hardBounce")).toBe("hard_bounce");
    expect(mapBlockReason("contactFlaggedAsSpam")).toBe("spam");
    expect(mapBlockReason("unsubscribedViaEmail")).toBe("unsubscribed");
    expect(mapBlockReason("adminBlocked")).toBe("manual");
  });
});

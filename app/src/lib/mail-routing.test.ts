import { describe, expect, it } from "vitest";
import { deliveryOf, isAllowed, parseAllowlist, relayTlsOptions, routeRecipients } from "./mail-routing";

const list = parseAllowlist("max.muster@example.com, @example.org")!;

describe("Freigabeliste", () => {
  it("parst Adressen und Domains, ignoriert Leeres", () => {
    expect(list).toEqual(["max.muster@example.com", "@example.org"]);
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist(" , ")).toBeNull();
  });
  it("erkennt Adressen und Domains, auch mit Anzeigename und Großschreibung", () => {
    expect(isAllowed('"Max" <Max.Muster@example.com>', list)).toBe(true);
    expect(isAllowed("kundin@example.org", list)).toBe(true);
    expect(isAllowed("x@sub.example.org", list)).toBe(false);
    expect(isAllowed("kunde@example.com", list)).toBe(false);
    expect(isAllowed("max.muster@example.com.evil.com", list)).toBe(false);
  });
});

describe("Routing", () => {
  const r = { to: ["kundin@example.org", "erika@example.com"], cc: ["max.muster@example.com"], bcc: ["bcc@example.com"] };
  it("capture: alles an Mailpit", () => {
    const x = routeRecipients(r, "capture", list);
    expect(deliveryOf(x)).toBe("captured");
    expect(x.captured.to).toHaveLength(2);
  });
  it("live ohne Liste: alles live", () => {
    expect(deliveryOf(routeRecipients(r, "live", null))).toBe("live");
  });
  it("live mit Liste: aufgeteilt, nichts geht verloren", () => {
    const x = routeRecipients(r, "live", list);
    expect(x.live).toEqual({ to: ["kundin@example.org"], cc: ["max.muster@example.com"], bcc: [] });
    expect(x.captured).toEqual({ to: ["erika@example.com"], cc: [], bcc: ["bcc@example.com"] });
    expect(deliveryOf(x)).toBe("mixed");
  });
  it("nur fremde Empfänger → captured", () => {
    expect(deliveryOf(routeRecipients({ to: ["a@example.com"] }, "live", list))).toBe("captured");
  });
});

describe("TLS fürs Relay", () => {
  it("587 erzwingt STARTTLS, 465 implizites TLS", () => {
    expect(relayTlsOptions(587, false)).toEqual({ secure: false, requireTLS: true });
    expect(relayTlsOptions(465, false)).toEqual({ secure: true, requireTLS: false });
    expect(relayTlsOptions(51025, false)).toEqual({ secure: false, requireTLS: false });
  });
});

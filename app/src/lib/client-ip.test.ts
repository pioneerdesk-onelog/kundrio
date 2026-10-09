import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const h = (xff?: string, real?: string) => {
  const x = new Headers();
  if (xff) x.set("x-forwarded-for", xff);
  if (real) x.set("x-real-ip", real);
  return x;
};

describe("clientIp", () => {
  it("ohne vertrauenswürdigen Proxy keine Header-IP", () => {
    expect(clientIp(h("1.2.3.4"), 0)).toBe("unbekannt");
  });
  it("nimmt bei einem Proxy den letzten Eintrag (gefälschte Einträge davor werden ignoriert)", () => {
    expect(clientIp(h("6.6.6.6, 1.2.3.4"), 1)).toBe("1.2.3.4");
  });
  it("zählt bei zwei Proxys von rechts", () => {
    expect(clientIp(h("6.6.6.6, 1.2.3.4, 10.0.0.2"), 2)).toBe("1.2.3.4");
  });
  it("fällt auf X-Real-IP zurück", () => {
    expect(clientIp(h(undefined, "5.6.7.8"), 1)).toBe("5.6.7.8");
  });
  it("zu wenige Einträge → unbekannt", () => {
    expect(clientIp(h("1.2.3.4"), 2)).toBe("unbekannt");
  });
});

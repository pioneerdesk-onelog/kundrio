import { describe, expect, it } from "vitest";
import { contrastRatio, isValidBic, isValidIban, isValidVatId, normalizeOrigin } from "./compliance-validators";

describe("Validatoren", () => {
  it("IBAN Mod-97", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 01")).toBe(false);
    expect(isValidIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(isValidIban("DE89")).toBe(false);
  });
  it("BIC und USt-ID", () => {
    expect(isValidBic("COBADEFFXXX")).toBe(true);
    expect(isValidBic("COBADEFF")).toBe(true);
    expect(isValidBic("COBA")).toBe(false);
    expect(isValidVatId("DE123456789")).toBe(true);
    expect(isValidVatId("DE12345678")).toBe(false);
  });
  it("Kontrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#0B4F6C", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#F2913A", "#ffffff")).toBeLessThan(4.5);
  });
  it("Origins", () => {
    expect(normalizeOrigin("https://onelog.pro")).toBe("https://onelog.pro");
    expect(normalizeOrigin("https://onelog.pro/")).toBe("https://onelog.pro");
    expect(normalizeOrigin("http://onelog.pro")).toBeNull();
    expect(normalizeOrigin("https://onelog.pro/pfad")).toBeNull();
  });
});

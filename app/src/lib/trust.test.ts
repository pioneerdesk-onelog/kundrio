import { describe, expect, it } from "vitest";
import { evaluateTrust, signFormTimestamp, trustLevel, verifyFormTimestamp } from "./trust";

describe("evaluateTrust", () => {
  it("bewertet einen normalen Lead mit Firmenadresse hoch", () => {
    const r = evaluateTrust({ email: "anna@firma-beispiel.de", elapsedMs: 25_000, userAgent: "Mozilla/5.0", mx: true });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["email_company", "mx_ok", "time_ok"]));
  });

  it("wertet Wegwerfadresse, Honeypot und Turbo-Ausfüllen stark ab", () => {
    const r = evaluateTrust({ email: "x@mailinator.com", honeypotFilled: true, elapsedMs: 400 });
    expect(r.score).toBe(0);
  });

  it("erkennt ungültige Adressen und fehlenden MX", () => {
    expect(evaluateTrust({ email: "kein-at-zeichen" }).signals[0].key).toBe("email_invalid");
    const r = evaluateTrust({ email: "a@gibtsnicht-xyz.de", mx: false });
    expect(r.signals.some((s) => s.key === "mx_missing")).toBe(true);
    expect(r.score).toBeLessThan(50);
  });

  it("markiert KI-Agenten neutral und wertet ihre Kennung nicht als Bot ab", () => {
    const r = evaluateTrust({ email: "b@gmail.com", viaAgent: true, userAgent: "ChatGPT-User/1.0 bot" });
    expect(r.signals.find((s) => s.key === "via_agent")?.impact).toBe(0);
    expect(r.signals.some((s) => s.key === "bot_ua")).toBe(false);
    expect(r.score).toBe(70);
  });

  it("zieht Skript-User-Agents und Häufungen ab", () => {
    const r = evaluateTrust({ email: "c@gmail.com", userAgent: "python-requests/2.31", recentCount: 4 });
    expect(r.signals.map((s) => s.key)).toEqual(expect.arrayContaining(["bot_ua", "burst"]));
    expect(r.score).toBe(25);
  });

  it("bleibt im Bereich 0–100", () => {
    const r = evaluateTrust({ email: "anna@firma.de", elapsedMs: 20_000, mx: true });
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("Formular-Zeitstempel", () => {
  const secret = "test-secret";
  it("liefert die Ausfüllzeit für gültige Token", () => {
    const t = signFormTimestamp(secret, "form1", 1_000_000);
    expect(verifyFormTimestamp(secret, "form1", t, 1_008_000)).toBe(8_000);
  });
  it("lehnt manipulierte, fremde oder alte Token ab", () => {
    const t = signFormTimestamp(secret, "form1", 1_000_000);
    expect(verifyFormTimestamp(secret, "form2", t, 1_008_000)).toBeNull();
    expect(verifyFormTimestamp(secret, "form1", t.replace(/.$/, "x"), 1_008_000)).toBeNull();
    expect(verifyFormTimestamp(secret, "form1", t, 1_000_000 + 25 * 3600 * 1000)).toBeNull();
    expect(verifyFormTimestamp(secret, "form1", undefined)).toBeNull();
  });
});

describe("trustLevel", () => {
  it("ordnet Stufen zu", () => {
    expect(trustLevel(null).tone).toBe("neutral");
    expect(trustLevel(80).tone).toBe("ok");
    expect(trustLevel(50).tone).toBe("warn");
    expect(trustLevel(10).tone).toBe("bad");
  });
});

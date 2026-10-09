import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeEqual, signWebhook, verifyWebhookSignature } from "./webhook-sign";
import { parseBrevoEvent } from "./mail-events-parse";

describe("Webhook-Signatur", () => {
  it("entspricht sha256-HMAC über den Rohtext", () => {
    const body = JSON.stringify({ event: "delivered", email: "a@b.de" });
    const expected = "sha256=" + createHmac("sha256", "geheim-geheim-geheim").update(body).digest("hex");
    expect(signWebhook("geheim-geheim-geheim", body)).toBe(expected);
    expect(verifyWebhookSignature("geheim-geheim-geheim", body, expected)).toBe(true);
    expect(verifyWebhookSignature("geheim-geheim-geheim", body + " ", expected)).toBe(false);
    expect(verifyWebhookSignature("geheim-geheim-geheim", body, null)).toBe(false);
  });

  it("vergleicht Geheimnisse sicher", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("parseBrevoEvent", () => {
  it("liest Brevo-Relay-Ereignisse inkl. X-Mailin-custom", () => {
    const e = parseBrevoEvent({
      event: "hard_bounce", email: "Bad@Example.com", "message-id": "abc@x.de", ts_epoch: 1791366000000, reason: "user unknown",
      "X-Mailin-custom": "pd:cmuwqh83l00060pbu0u4pusub",
    });
    expect(e).toMatchObject({ event: "hard_bounce", email: "bad@example.com", messageIdHeader: "<abc@x.de>", pdId: "cmuwqh83l00060pbu0u4pusub", reason: "user unknown" });
    expect(e?.at.getTime()).toBe(1791366000000);
  });

  it("normalisiert Namen und verwirft Unbrauchbares", () => {
    expect(parseBrevoEvent({ event: "invalid_email", email: "x@y.de" })?.event).toBe("invalid");
    expect(parseBrevoEvent({ event: "complaint", email: "x@y.de" })?.event).toBe("spam");
    expect(parseBrevoEvent({ event: "unbekannt", email: "x@y.de" })).toBeNull();
    expect(parseBrevoEvent({ event: "delivered" })).toBeNull();
  });
});

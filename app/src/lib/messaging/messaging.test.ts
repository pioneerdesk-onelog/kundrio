import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isE164, toE164 } from "./phone";
import { checkSend, isStartMessage, isStopMessage, withinWindow } from "./rules";
import { parseNumberAllowlist, routeNumber } from "./mode";
import { signMeta, signSeven, verifyMetaSignature, verifySevenSignature } from "./signatures";
import { mapSevenStatus, parseSevenWebhook, parseWhatsAppWebhook } from "./parse";
import { buildWaPayload, allowedMediaHost } from "./whatsapp-cloud";
import { validSenderId } from "./seven-sms";

// Fixtures nach offizieller Doku (developers.facebook.com, docs.seven.io)
const WA_TEXT = {
  object: "whatsapp_business_account",
  entry: [{ id: "102290129340398", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
    contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
    messages: [{ from: "16505551234", id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=", timestamp: "1749416383", type: "text", text: { body: "Does it come in another color?" } }],
  } }] }],
};
const WA_STATUS = {
  object: "whatsapp_business_account",
  entry: [{ id: "102290129340398", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
    statuses: [
      { id: "wamid.A", status: "delivered", timestamp: "1750263773", recipient_id: "16505551234", errors: [] },
      { id: "wamid.B", status: "failed", timestamp: "1750263774", recipient_id: "16505551234", errors: [{ code: 131047, title: "Re-engagement message" }] },
    ],
  } }] }],
};
const SEVEN_MO = { data: { id: "681590", sender: "491771783130", system: "491579999999", text: "STOP", time: "1605878104", message_type: "SMS" }, webhook_event: "sms_mo", webhook_timestamp: "2020-12-02 11:55:44" };
const SEVEN_DLR = { data: { msg_id: "77149843739", status: "DELIVERED", timestamp: "2021-08-24 08:08:00.000000" }, webhook_event: "dlr", webhook_timestamp: "2021-08-24T08:08:00+02:00" };

describe("Rufnummern (E.164)", () => {
  it("normalisiert deutsche und internationale Formate", () => {
    expect(toE164("0170 1234567")).toBe("+491701234567");
    expect(toE164("+49 (170) 123-4567")).toBe("+491701234567");
    expect(toE164("0049 170 1234567")).toBe("+491701234567");
    expect(toE164("491701234567")).toBe("+491701234567"); // wa_id ohne +
    expect(toE164("16505551234")).toBe("+16505551234");
  });
  it("lehnt Ungültiges ab", () => {
    expect(toE164("")).toBeNull();
    expect(toE164("12")).toBeNull();
    expect(toE164("keine nummer")).toBeNull();
    expect(isE164("+491701234567")).toBe(true);
    expect(isE164("0170")).toBe(false);
  });
});

describe("STOP/START", () => {
  it("erkennt Abmeldungen", () => {
    for (const t of ["STOP", "stop", "Stopp!", "ABMELDEN", "Bitte abmelden", "unsubscribe", "abbestellen"]) expect(isStopMessage(t)).toBe(true);
  });
  it("keine Fehlalarme in normalen Sätzen", () => {
    expect(isStopMessage("Können wir den Termin stoppen und morgen weitermachen? Wir haben noch viele Fragen zum Angebot")).toBe(false);
    expect(isStopMessage("Danke!")).toBe(false);
    expect(isStartMessage("START")).toBe(true);
    expect(isStartMessage("start bitte")).toBe(false);
  });
});

describe("Versandregeln", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const base = { hasNumber: true, consent: {}, usesTemplate: false, now };
  it("24-h-Fenster", () => {
    expect(withinWindow(new Date("2026-10-07T00:00:00Z"), now)).toBe(true);
    expect(withinWindow(new Date("2026-10-06T11:59:00Z"), now)).toBe(false);
    expect(withinWindow(null, now)).toBe(false);
  });
  it("WhatsApp-Freitext außerhalb des Fensters gesperrt, Vorlage erlaubt", () => {
    expect(checkSend({ ...base, kind: "whatsapp", purpose: "transactional", lastInboundAt: null })).toMatchObject({ ok: false, code: "window_closed" });
    expect(checkSend({ ...base, kind: "whatsapp", purpose: "transactional", lastInboundAt: null, usesTemplate: true })).toEqual({ ok: true });
    expect(checkSend({ ...base, kind: "whatsapp", purpose: "transactional", lastInboundAt: new Date("2026-10-07T10:00:00Z") })).toEqual({ ok: true });
  });
  it("Werbung nur mit Einwilligung (§ 7 UWG)", () => {
    expect(checkSend({ ...base, kind: "sms", purpose: "marketing" })).toMatchObject({ ok: false, code: "no_consent" });
    expect(checkSend({ ...base, kind: "sms", purpose: "marketing", consent: { smsConsentAt: now } })).toEqual({ ok: true });
    expect(checkSend({ ...base, kind: "sms", purpose: "transactional" })).toEqual({ ok: true });
  });
  it("Abmeldung sperrt alles, fehlende Nummer ebenso", () => {
    expect(checkSend({ ...base, kind: "whatsapp", purpose: "transactional", usesTemplate: true, consent: { whatsappConsentAt: now, whatsappOptOutAt: now } })).toMatchObject({ ok: false, code: "opted_out" });
    expect(checkSend({ ...base, kind: "sms", purpose: "transactional", consent: { smsOptOutAt: now } })).toMatchObject({ ok: false, code: "opted_out" });
    expect(checkSend({ ...base, hasNumber: false, kind: "sms", purpose: "transactional" })).toMatchObject({ ok: false, code: "no_number" });
  });
});

describe("Testmodus", () => {
  it("capture sendet nie", () => {
    expect(routeNumber("+491701234567", { MESSAGING_MODE: "capture" })).toBe("captured");
    expect(routeNumber("+491701234567", {})).toBe("captured");
  });
  it("live mit Freigabeliste nur an gelistete Nummern", () => {
    const env = { MESSAGING_MODE: "live", MESSAGING_LIVE_ALLOWLIST: "0170 1234567, +49 157 0000000" };
    expect(parseNumberAllowlist(env.MESSAGING_LIVE_ALLOWLIST)).toEqual(["+491701234567", "+491570000000"]);
    expect(routeNumber("+491701234567", env)).toBe("live");
    expect(routeNumber("+491709999999", env)).toBe("captured");
    expect(routeNumber("+491709999999", { MESSAGING_MODE: "live" })).toBe("live");
  });
});

describe("Signaturen", () => {
  it("Meta X-Hub-Signature-256", () => {
    const body = JSON.stringify(WA_TEXT);
    const sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(signMeta(body, "app-secret")).toBe(sig);
    expect(verifyMetaSignature(body, sig, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "falsch")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
  });
  it("seven.io: Timestamp\\nNonce\\nMETHOD\\nURL\\nMD5(Body), Hex", () => {
    const body = JSON.stringify(SEVEN_MO);
    const ts = "1791374400";
    const nonce = "a".repeat(32);
    const url = "https://crm.example.de/api/messaging/seven/ckabc1234567";
    const expected = createHmac("sha256", "sec").update([ts, nonce, "POST", url, createHash("md5").update(body).digest("hex")].join("\n")).digest("hex");
    expect(signSeven({ timestamp: ts, nonce, method: "post", url, body, secret: "sec" })).toBe(expected);
    const now = Number(ts) * 1000 + 5_000;
    expect(verifySevenSignature({ signature: expected, timestamp: ts, nonce, method: "POST", url, body, secret: "sec", now }).ok).toBe(true);
    expect(verifySevenSignature({ signature: expected, timestamp: ts, nonce, method: "POST", url, body, secret: "sec", now: now + 60_000 })).toMatchObject({ ok: false, reason: "Zeitstempel abgelaufen" });
    expect(verifySevenSignature({ signature: expected, timestamp: ts, nonce, method: "POST", url: url + "x", body, secret: "sec", now }).ok).toBe(false);
    expect(verifySevenSignature({ signature: null, timestamp: ts, nonce, method: "POST", url, body, secret: "sec", now }).ok).toBe(false);
  });
});

describe("Webhook-Parser", () => {
  it("WhatsApp-Textnachricht", () => {
    const p = parseWhatsAppWebhook(WA_TEXT);
    expect(p.channelId).toBe("106540352242922");
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]).toMatchObject({ from: "+16505551234", fromName: "Sheena Nelson", to: "+15550783881", text: "Does it come in another color?" });
    expect(p.messages[0].receivedAt.getTime()).toBe(1749416383000);
  });
  it("WhatsApp-Status inkl. Fehler", () => {
    const p = parseWhatsAppWebhook(WA_STATUS);
    expect(p.updates.map((u) => u.status)).toEqual(["delivered", "failed"]);
    expect(p.updates[1].error).toContain("131047");
  });
  it("WhatsApp-Medien und fremde Objekte", () => {
    const doc = structuredClone(WA_TEXT) as typeof WA_TEXT;
    (doc.entry[0].changes[0].value.messages[0] as Record<string, unknown>) = { from: "16505551234", id: "wamid.D", timestamp: "1749416383", type: "document", document: { id: "MEDIA1", mime_type: "application/pdf", filename: "rechnung.pdf" } };
    const p = parseWhatsAppWebhook(doc);
    expect(p.messages[0].media).toEqual({ id: "MEDIA1", mime: "application/pdf", filename: "rechnung.pdf", caption: undefined });
    expect(p.messages[0].text).toBe("[Dokument: rechnung.pdf]");
    expect(parseWhatsAppWebhook({ object: "page" }).messages).toHaveLength(0);
  });
  it("seven.io sms_mo und dlr", () => {
    const mo = parseSevenWebhook(SEVEN_MO);
    expect(mo.messages[0]).toMatchObject({ externalId: "seven:681590", from: "+491771783130", to: "+491579999999", text: "STOP" });
    const dlr = parseSevenWebhook(SEVEN_DLR);
    expect(dlr.updates[0]).toMatchObject({ externalId: "seven:77149843739", status: "delivered" });
    expect(mapSevenStatus("NOTDELIVERED")).toBe("failed");
    expect(mapSevenStatus("TRANSMITTED")).toBe("sent");
    expect(mapSevenStatus("???")).toBeNull();
  });
});

describe("Payloads & Prüfungen", () => {
  it("WhatsApp-Text und -Vorlage", () => {
    expect(buildWaPayload("+491701234567", { to: [], text: "Hallo" })).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "+491701234567", type: "text", text: { preview_url: false, body: "Hallo" } });
    const t = buildWaPayload("+491701234567", { to: [], text: "", template: { name: "termin_erinnerung", language: "de", params: ["Anna", "Montag"] } }) as { template: { components: { parameters: unknown[] }[] } };
    expect(t.template.components[0].parameters).toEqual([{ type: "text", text: "Anna" }, { type: "text", text: "Montag" }]);
  });
  it("Medien nur von Meta-Hosts", () => {
    expect(allowedMediaHost("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", {})).toBe(true);
    expect(allowedMediaHost("https://evil.example.com/x", {})).toBe(false);
    expect(allowedMediaHost("http://127.0.0.1:9/x", { WHATSAPP_GRAPH_BASE: "http://127.0.0.1:9/v25.0" })).toBe(true);
  });
  it("Absenderkennung", () => {
    expect(validSenderId("OneLog")).toBe(true);
    expect(validSenderId("+491701234567")).toBe(true);
    expect(validSenderId("VielZuLangerName")).toBe(false);
  });
});

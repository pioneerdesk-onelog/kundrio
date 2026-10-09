import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mapMollie, mollie } from "./connectors/mollie";
import { mapRevolut, revolut, verifyRevolutSignature } from "./connectors/revolut";
import { mapUnzer, unzer } from "./connectors/unzer";
import { centsToDecimal, decimalToCents } from "./http";
import { maskSecret, openCredentials, payToken, sealCredentials, verifyPayToken } from "./crypto";
import type { CreateInput } from "./types";

beforeAll(() => {
  process.env.APP_SECRET = process.env.APP_SECRET || "test-secret-for-vitest-only-0123456789";
});
afterEach(() => vi.unstubAllGlobals());

const input: CreateInput = {
  amountCents: 11900,
  currency: "EUR",
  description: "Rechnung RE-2026-0042",
  returnUrl: "https://app.example/zahlung/tok?r=x",
  webhookUrl: "https://app.example/api/payments/mollie/abc",
  idempotencyKey: "pay-inv-1-11900",
  metadata: { workspaceId: "ws1", invoiceId: "inv1", paymentRef: "inv1-1" },
};

function stubFetch(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

describe("Beträge", () => {
  it("wandelt Cent ↔ Dezimal ohne Rundungsfehler", () => {
    expect(centsToDecimal(11900)).toBe("119.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-1234)).toBe("-12.34");
    expect(decimalToCents("119.00")).toBe(11900);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("10.005")).toBe(1001);
    expect(decimalToCents("1234.56")).toBe(123456);
    expect(decimalToCents(undefined)).toBe(0);
  });
});

describe("Mollie", () => {
  it("bildet Status inkl. Teil-/Vollerstattung ab", () => {
    const base = { id: "tr_abc123", amount: { currency: "EUR", value: "119.00" }, _links: { checkout: { href: "https://www.mollie.com/checkout/x" } } };
    expect(mapMollie({ ...base, status: "open" }).status).toBe("open");
    expect(mapMollie({ ...base, status: "paid", method: "wero" }).status).toBe("paid");
    expect(mapMollie({ ...base, status: "paid", amountRefunded: { currency: "EUR", value: "19.00" } })).toMatchObject({ status: "partially_refunded", refundedCents: 1900 });
    expect(mapMollie({ ...base, status: "paid", amountRefunded: { currency: "EUR", value: "119.00" } }).status).toBe("refunded");
    expect(mapMollie({ ...base, status: "expired" }).checkoutUrl).toBe("https://www.mollie.com/checkout/x");
  });

  it("legt Zahlung mit Dezimalbetrag, Idempotency-Key und Webhook an", async () => {
    const calls = stubFetch({ id: "tr_new1", status: "open", amount: { currency: "EUR", value: "119.00" }, _links: { checkout: { href: "https://www.mollie.com/checkout/new1" } } }, 201);
    const p = await mollie.create({ apiKey: "test_abcdefghijklmnopqrstuvwxyz12" }, "test", { ...input, methods: ["wero"] });
    expect(p).toMatchObject({ externalId: "tr_new1", status: "open", amountCents: 11900, checkoutUrl: "https://www.mollie.com/checkout/new1" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ amount: { currency: "EUR", value: "119.00" }, description: "Rechnung RE-2026-0042", method: "wero", webhookUrl: input.webhookUrl, metadata: input.metadata });
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("pay-inv-1-11900");
  });

  it("lässt localhost-Webhooks weg (Mollie würde ablehnen)", async () => {
    const calls = stubFetch({ id: "tr_new2", status: "open", amount: { currency: "EUR", value: "1.00" }, _links: { checkout: { href: "https://x" } } });
    await mollie.create({ apiKey: "test_abcdefghijklmnopqrstuvwxyz12" }, "test", { ...input, webhookUrl: "http://127.0.0.1:3100/api/payments/mollie/x" });
    expect(JSON.parse(String(calls[0].init.body)).webhookUrl).toBeUndefined();
  });

  it("Webhook: nur ID übernehmen, Format prüfen", () => {
    expect(mollie.checkWebhook({}, { headers: new Headers(), rawBody: "id=tr_d0b0E3EA3v" })).toEqual({ ok: true, externalIds: ["tr_d0b0E3EA3v"] });
    expect(mollie.checkWebhook({}, { headers: new Headers(), rawBody: "id=../../etc" }).ok).toBe(false);
    expect(mollie.checkWebhook({}, { headers: new Headers(), rawBody: '{"status":"paid"}' }).ok).toBe(false);
  });

  it("lehnt falsche Schlüssel ab und schwärzt sie in Fehlern", async () => {
    await expect(mollie.create({ apiKey: "sk_wrong" }, "test", input)).rejects.toThrow(/Format/);
    stubFetch({ detail: "key test_abcdefghijklmnopqrstuvwxyz12 invalid" }, 422);
    await expect(mollie.create({ apiKey: "test_abcdefghijklmnopqrstuvwxyz12" }, "test", input)).rejects.toThrow(/\[geschwärzt\]/);
  });

  it("erkennt Test/Live am Schlüssel", () => {
    expect(mollie.detectMode({ apiKey: "live_x" })).toBe("live");
    expect(mollie.detectMode({ apiKey: "test_x" })).toBe("test");
  });
});

describe("Revolut Merchant", () => {
  const secret = "wsk_r59a4HfWVAKycbCaNO1RvgCJec02gRd8";
  const body = JSON.stringify({ event: "ORDER_COMPLETED", order_id: "9fc01989-3f61-4484-a5d9-ffe768531be9", merchant_order_ext_ref: "Test #3928" });
  const ts = "1683650202360";
  const sig = `v1=${createHmac("sha256", secret).update(`v1.${ts}.${body}`).digest("hex")}`;
  const now = Number(ts) + 1000;

  it("prüft die Signatur (v1, HMAC-SHA256, Zeitfenster 5 min)", () => {
    expect(verifyRevolutSignature(body, sig, ts, secret, now)).toBe(true);
    expect(verifyRevolutSignature(body, `v1=deadbeef,${sig}`, ts, secret, now)).toBe(true);
    expect(verifyRevolutSignature(body, sig, ts, "wsk_other", now)).toBe(false);
    expect(verifyRevolutSignature(body + " ", sig, ts, secret, now)).toBe(false);
    expect(verifyRevolutSignature(body, sig, ts, secret, Number(ts) + 6 * 60_000)).toBe(false);
    expect(verifyRevolutSignature(body, null, ts, secret, now)).toBe(false);
  });

  it("Webhook liefert Order-ID nur bei gültiger Signatur", () => {
    const h = new Headers({ "revolut-signature": sig, "revolut-request-timestamp": ts });
    expect(revolut.checkWebhook({ secretKey: "sk_x", webhookSecret: secret }, { headers: h, rawBody: body, now })).toEqual({ ok: true, externalIds: ["9fc01989-3f61-4484-a5d9-ffe768531be9"] });
    expect(revolut.checkWebhook({ secretKey: "sk_x" }, { headers: h, rawBody: body, now })).toMatchObject({ ok: false, status: 401 });
    expect(revolut.checkWebhook({ secretKey: "sk_x", webhookSecret: "wsk_falsch" }, { headers: h, rawBody: body, now })).toMatchObject({ ok: false, status: 401 });
  });

  it("bildet Order-Status ab", () => {
    const o = { id: "6516e61c-d279-a454-a837-bc52ce55ed49", amount: 11900, currency: "EUR", checkout_url: "https://checkout.revolut.com/payment-link/x" };
    expect(mapRevolut({ ...o, state: "pending" }).status).toBe("open");
    expect(mapRevolut({ ...o, state: "completed", payments: [{ state: "completed", payment_method: { type: "REVOLUT_PAY" } }] })).toMatchObject({ status: "paid", method: "revolut_pay" });
    expect(mapRevolut({ ...o, state: "completed", refunded_amount: 1000 }).status).toBe("partially_refunded");
    expect(mapRevolut({ ...o, state: "cancelled" }).status).toBe("canceled");
  });

  it("sendet Betrag in Cent und API-Version", async () => {
    const calls = stubFetch({ id: "6516e61c-d279-a454-a837-bc52ce55ed49", state: "pending", amount: 11900, currency: "EUR", checkout_url: "https://checkout.revolut.com/payment-link/x" });
    process.env.REVOLUT_MERCHANT_BASE = "";
    const p = await revolut.create({ secretKey: "sk_abcdefghijkl" }, "test", input);
    expect(calls[0].url).toBe("https://sandbox-merchant.revolut.com/api/orders");
    expect((calls[0].init.headers as Record<string, string>)["Revolut-Api-Version"]).toBe("2026-08-17");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ amount: 11900, currency: "EUR", redirect_url: input.returnUrl });
    expect(p.checkoutUrl).toContain("checkout.revolut.com");
  });
});

describe("Unzer", () => {
  it("bildet Zahlungsstatus und Zahlart ab", () => {
    const p = { id: "s-pay-774", amount: { total: "119.0000", charged: "119.0000", canceled: "0.0000", currency: "EUR" }, resources: { typeId: "s-wro-e48471ca" } };
    expect(mapUnzer({ ...p, state: { name: "completed" } })).toMatchObject({ status: "paid", method: "wero", amountCents: 11900 });
    expect(mapUnzer({ ...p, state: { name: "completed" }, amount: { ...p.amount, canceled: "19.00" } })).toMatchObject({ status: "partially_refunded", refundedCents: 1900 });
    expect(mapUnzer({ ...p, state: { name: "pending" }, amount: { total: "119", charged: "0", canceled: "0" } }).status).toBe("open");
    expect(mapUnzer({ ...p, state: { name: "canceled" }, amount: { total: "119", charged: "0", canceled: "0" } }).status).toBe("canceled");
    expect(mapUnzer({ ...p, state: { name: "chargeback" } }).status).toBe("refunded");
  });

  it("Webhook: paymentId übernehmen, Public Key prüfen, retrieveUrl ignorieren", () => {
    const body = JSON.stringify({ event: "payment.completed", publicKey: "s-pub-abc", retrieveUrl: "https://evil.example/x", paymentId: "s-pay-774" });
    expect(unzer.checkWebhook({ privateKey: "s-priv-x" }, { headers: new Headers(), rawBody: body })).toEqual({ ok: true, externalIds: ["s-pay-774"] });
    expect(unzer.checkWebhook({ privateKey: "s-priv-x", publicKey: "s-pub-other" }, { headers: new Headers(), rawBody: body }).ok).toBe(false);
    expect(unzer.checkWebhook({}, { headers: new Headers(), rawBody: JSON.stringify({ paymentId: "s-pay-../x" }) }).ok).toBe(false);
  });

  it("Basic-Auth mit Private Key, Bezahlseite anlegen", async () => {
    const calls = stubFetch({ id: "s-ppg-123abc", redirectUrl: "https://payment.unzer.com/v1/paypage/s-ppg-123abc", resources: { paymentId: "s-pay-900" } });
    process.env.UNZER_API_BASE = "";
    const p = await unzer.create({ privateKey: "s-priv-2a10abcdefghij" }, "test", input);
    expect(calls[0].url).toBe("https://sbx-api.unzer.com/v1/paypage/charge");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("s-priv-2a10abcdefghij:").toString("base64")}`);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ amount: "119.00", currency: "EUR", invoiceId: "Rechnung RE-2026-0042" });
    expect(p).toMatchObject({ externalId: "s-pay-900", checkoutUrl: "https://payment.unzer.com/v1/paypage/s-ppg-123abc" });
  });
});

describe("Verschlüsselung und Bezahl-Token", () => {
  it("Zugangsdaten: verschlüsselt und wieder lesbar, Manipulation → leer", () => {
    const s = sealCredentials({ apiKey: "test_abc" });
    expect(s).not.toContain("test_abc");
    expect(openCredentials(s)).toEqual({ apiKey: "test_abc" });
    expect(openCredentials(s.slice(0, -2) + "xx")).toEqual({});
    expect(maskSecret("test_abcdefghijklmnop")).toBe("test_…mnop");
  });

  it("Token je Rechnung, fälschungssicher", () => {
    const t = payToken("clxinvoice0000001");
    expect(verifyPayToken(t)).toEqual({ invoiceId: "clxinvoice0000001", version: 1 });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ i: "clxinvoice0000002", v: 1 })).toString("base64url");
    expect(verifyPayToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyPayToken(`${payload}.x${sig.slice(1)}`)).toBeNull();
    expect(verifyPayToken("unsinn")).toBeNull();
  });
});

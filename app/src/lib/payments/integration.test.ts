// Integrationstest der Konnektoren über echtes HTTP gegen lokale Mock-Server (keine echten Zahlungen).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockProviders, pointConnectorsAt, type MockState } from "./testing/mock-providers";
import { CONNECTORS } from "./registry";
import type { CreateInput } from "./types";

let mock: { url: string; state: MockState; close: () => Promise<void> };

beforeAll(async () => {
  mock = await startMockProviders();
  pointConnectorsAt(mock.url);
});
afterAll(async () => {
  await mock.close();
  delete process.env.MOLLIE_API_BASE;
  delete process.env.REVOLUT_MERCHANT_BASE;
  delete process.env.UNZER_API_BASE;
});

const input = (key: string): CreateInput => ({
  amountCents: 11900,
  currency: "EUR",
  description: "Rechnung RE-2026-0042",
  returnUrl: "http://127.0.0.1:3100/zahlung/t?r=1",
  webhookUrl: "http://127.0.0.1:3100/api/payments/x/y",
  idempotencyKey: key,
  metadata: { workspaceId: "ws", invoiceId: "inv", paymentRef: "inv-1" },
});

describe("Mollie gegen Mock", () => {
  const creds = { apiKey: "test_mockmockmockmockmockmock01" };
  it("Verbindungstest, Anlage (idempotent), Status, Teilerstattung", async () => {
    expect(await CONNECTORS.mollie.test(creds, "test")).toMatch(/Wero/);
    const a = await CONNECTORS.mollie.create(creds, "test", input("k-1"));
    const b = await CONNECTORS.mollie.create(creds, "test", input("k-1"));
    expect(b.externalId).toBe(a.externalId);
    expect(a.checkoutUrl).toContain("/checkout/");
    mock.state.mollie.get(a.externalId)!.status = "paid";
    mock.state.mollie.get(a.externalId)!.method = "wero";
    expect(await CONNECTORS.mollie.get(creds, "test", a.externalId)).toMatchObject({ status: "paid", method: "wero", amountCents: 11900 });
    await CONNECTORS.mollie.refund(creds, "test", a.externalId, 1900, "EUR", "r-1", "Erstattung");
    expect(await CONNECTORS.mollie.get(creds, "test", a.externalId)).toMatchObject({ status: "partially_refunded", refundedCents: 1900 });
  });
  it("falscher Schlüssel → verständlicher Fehler", async () => {
    await expect(CONNECTORS.mollie.test({ apiKey: "live_mockmockmockmockmockmock01" }, "live")).rejects.toThrow(/Zugang abgelehnt/);
  });
});

describe("Revolut gegen Mock", () => {
  const creds: Record<string, string> = { secretKey: "sk_mockmockmock01" };
  it("Webhook einrichten liefert Signatur-Geheimnis; Order-Zyklus", async () => {
    expect(await CONNECTORS.revolut.test(creds, "test")).toMatch(/Sandbox/);
    const wh = await CONNECTORS.revolut.registerWebhook!(creds, "test", "https://kundrio.example/api/payments/revolut/x");
    expect(wh.signingSecret).toBe("wsk_mockSigningSecret0001");
    const o = await CONNECTORS.revolut.create(creds, "test", input("k-2"));
    expect(o.status).toBe("open");
    mock.state.revolut.get(o.externalId)!.state = "completed";
    expect(await CONNECTORS.revolut.get(creds, "test", o.externalId)).toMatchObject({ status: "paid", method: "revolut_pay" });
    await CONNECTORS.revolut.refund(creds, "test", o.externalId, 11900, "EUR", "r-2", "Erstattung");
    expect((await CONNECTORS.revolut.get(creds, "test", o.externalId)).status).toBe("refunded");
    const refundReq = mock.state.requests.find((r) => r.path.endsWith("/refund"));
    expect(refundReq?.headers["idempotency-key"]).toBe("r-2");
  });
});

describe("Unzer gegen Mock", () => {
  const creds = { privateKey: "s-priv-mockmockmock01" };
  it("Bezahlseite, Status, Erstattung", async () => {
    expect(await CONNECTORS.unzer.test(creds, "test")).toMatch(/wero/);
    const p = await CONNECTORS.unzer.create(creds, "test", input("k-3"));
    expect(p.externalId).toMatch(/^s-pay-/);
    const u = mock.state.unzer.get(p.externalId)!;
    u.state = "completed";
    u.charged = "119.00";
    expect(await CONNECTORS.unzer.get(creds, "test", p.externalId)).toMatchObject({ status: "paid", method: "wero" });
    await CONNECTORS.unzer.refund(creds, "test", p.externalId, 1900, "EUR", "r-3", "Erstattung");
    expect(await CONNECTORS.unzer.get(creds, "test", p.externalId)).toMatchObject({ status: "partially_refunded", refundedCents: 1900 });
  });
});

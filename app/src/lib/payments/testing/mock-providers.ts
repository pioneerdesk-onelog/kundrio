// Lokaler Mock-Server für Mollie, Revolut Merchant und Unzer (nur Tests – keine echten Zahlungen).
// Bildet die genutzten Endpunkte nach; Zustand im Speicher, per `state` steuerbar.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type MolliePay = { id: string; status: string; amount: { currency: string; value: string }; amountRefunded?: { currency: string; value: string }; method: string | null; metadata: unknown; description: string };
type RevOrder = { id: string; state: string; amount: number; currency: string; refunded_amount: number; description: string };
type UnzerPay = { id: string; state: string; total: string; charged: string; canceled: string; typeId: string };

export type MockState = {
  mollie: Map<string, MolliePay>;
  revolut: Map<string, RevOrder>;
  unzer: Map<string, UnzerPay>;
  requests: { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string }[];
  idempotency: Map<string, unknown>;
};

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

export async function startMockProviders(): Promise<{ url: string; state: MockState; close: () => Promise<void> }> {
  const state: MockState = { mollie: new Map(), revolut: new Map(), unzer: new Map(), requests: [], idempotency: new Map() };
  let seq = 0;
  let url = "";
  const server: Server = createServer(async (req, res) => {
    const body = await read(req);
    const path = (req.url ?? "").split("?")[0];
    state.requests.push({ method: req.method ?? "", path, headers: req.headers, body });
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const auth = String(req.headers.authorization ?? "");
    let m: RegExpExecArray | null;

    // ---------- Mollie ----------
    if (path.startsWith("/mollie/")) {
      if (!/^Bearer test_/.test(auth)) return json(401, { status: 401, title: "Unauthorized" });
      const p = path.slice("/mollie".length);
      if (req.method === "GET" && p === "/methods") return json(200, { _embedded: { methods: [{ id: "wero", description: "Wero" }, { id: "creditcard", description: "Kreditkarte" }] } });
      if (req.method === "POST" && p === "/payments") {
        const key = String(req.headers["idempotency-key"] ?? "");
        if (key && state.idempotency.has(`m:${key}`)) return json(201, state.idempotency.get(`m:${key}`));
        const b = JSON.parse(body) as { amount: { currency: string; value: string }; method?: string | string[]; metadata: unknown; description: string };
        const id = `tr_mock${++seq}x`;
        const pay: MolliePay = { id, status: "open", amount: b.amount, method: null, metadata: b.metadata, description: b.description };
        state.mollie.set(id, pay);
        const out = { ...pay, mode: "test", _links: { checkout: { href: `${url}/checkout/${id}` } } };
        if (key) state.idempotency.set(`m:${key}`, out);
        return json(201, out);
      }
      if ((m = /^\/payments\/(tr_\w+)$/.exec(p)) && req.method === "GET") {
        const pay = state.mollie.get(m[1]);
        return pay ? json(200, { ...pay, mode: "test", _links: pay.status === "open" ? { checkout: { href: `${url}/checkout/${pay.id}` } } : {} }) : json(404, { status: 404 });
      }
      if ((m = /^\/payments\/(tr_\w+)\/refunds$/.exec(p)) && req.method === "POST") {
        const pay = state.mollie.get(m[1]);
        if (!pay) return json(404, { status: 404 });
        const b = JSON.parse(body) as { amount: { value: string } };
        const before = Number(pay.amountRefunded?.value ?? 0);
        pay.amountRefunded = { currency: "EUR", value: (before + Number(b.amount.value)).toFixed(2) };
        return json(201, { id: `re_mock${++seq}`, status: "pending" });
      }
      return json(404, { status: 404 });
    }

    // ---------- Revolut Merchant ----------
    if (path.startsWith("/revolut/")) {
      if (!/^Bearer sk_/.test(auth)) return json(401, { code: "unauthenticated" });
      const p = path.slice("/revolut".length);
      if (p === "/api/webhooks" && req.method === "GET") return json(200, []);
      if (p === "/api/webhooks" && req.method === "POST") return json(200, { id: "wh-mock-1", url: JSON.parse(body).url, events: JSON.parse(body).events, signing_secret: "wsk_mockSigningSecret0001" });
      if (p === "/api/orders" && req.method === "POST") {
        const b = JSON.parse(body) as { amount: number; currency: string; description: string };
        const id = `6516e61c-d279-a454-a837-${String(++seq).padStart(12, "0")}`;
        state.revolut.set(id, { id, state: "pending", amount: b.amount, currency: b.currency, refunded_amount: 0, description: b.description });
        return json(201, { ...state.revolut.get(id), checkout_url: `${url}/checkout/${id}` });
      }
      if ((m = /^\/api\/orders\/([0-9a-f-]+)$/.exec(p)) && req.method === "GET") {
        const o = state.revolut.get(m[1]);
        return o ? json(200, { ...o, checkout_url: `${url}/checkout/${o.id}`, payments: o.state === "completed" ? [{ state: "completed", payment_method: { type: "REVOLUT_PAY" } }] : [] }) : json(404, { code: "not_found" });
      }
      if ((m = /^\/api\/orders\/([0-9a-f-]+)\/refund$/.exec(p)) && req.method === "POST") {
        const o = state.revolut.get(m[1]);
        if (!o) return json(404, { code: "not_found" });
        o.refunded_amount += (JSON.parse(body) as { amount: number }).amount;
        return json(201, { id: "refund-order-1", state: "completed" });
      }
      return json(404, { code: "not_found" });
    }

    // ---------- Unzer ----------
    if (path.startsWith("/unzer/")) {
      const key = Buffer.from(auth.replace(/^Basic /, ""), "base64").toString("utf8");
      if (!/^s-priv-/.test(key)) return json(401, { isError: true });
      const p = path.slice("/unzer".length);
      if (p === "/keypair" && req.method === "GET") return json(200, { publicKey: "s-pub-mock", availablePaymentTypes: ["wero", "card"] });
      if (p === "/webhooks" && req.method === "POST") return json(201, { id: "s-whk-1" });
      if (p === "/paypage/charge" && req.method === "POST") {
        const b = JSON.parse(body) as { amount: string };
        const id = `s-pay-${++seq}`;
        state.unzer.set(id, { id, state: "pending", total: b.amount, charged: "0", canceled: "0", typeId: "s-wro-abc" });
        return json(200, { id: `s-ppg-${seq}`, redirectUrl: `${url}/checkout/${id}`, resources: { paymentId: id } });
      }
      if ((m = /^\/payments\/(s-pay-\d+)$/.exec(p)) && req.method === "GET") {
        const u = state.unzer.get(m[1]);
        return u ? json(200, { id: u.id, state: { name: u.state }, amount: { total: u.total, charged: u.charged, canceled: u.canceled, currency: "EUR" }, resources: { typeId: u.typeId } }) : json(404, { isError: true });
      }
      if ((m = /^\/payments\/(s-pay-\d+)\/charges\/cancels$/.exec(p)) && req.method === "POST") {
        const u = state.unzer.get(m[1]);
        if (!u) return json(404, { isError: true });
        u.canceled = (Number(u.canceled) + Number((JSON.parse(body) as { amount: string }).amount)).toFixed(2);
        return json(200, { id: "s-cnl-1", isSuccess: true });
      }
      return json(404, { isError: true });
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Umgebungsvariablen so setzen, dass alle Konnektoren den Mock nutzen. */
export function pointConnectorsAt(url: string) {
  process.env.MOLLIE_API_BASE = `${url}/mollie`;
  process.env.REVOLUT_MERCHANT_BASE = `${url}/revolut`;
  process.env.UNZER_API_BASE = `${url}/unzer`;
}

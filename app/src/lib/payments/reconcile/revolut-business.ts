// Revolut Business API (Kontoumsätze lesen) – OpenAPI: github.com/revolut-engineering/revolut-openapi (yaml/business.yaml).
// Server: https://b2b.revolut.com/api/1.0 · Sandbox: https://sandbox-b2b.revolut.com/api/1.0
// Anmeldung: Zertifikat (RSA) in Revolut Business hochladen, Zustimmung erteilen → Autorisierungscode →
// POST /auth/token mit client_assertion (JWT, RS256, aud https://revolut.com). Access-Token ~40 min gültig,
// Refresh-Token laut Doku-Auszug 90 Tage (danach Zustimmung erneut erteilen) – nicht live verifiziert.
// Nur Leserecht (Scope READ) nötig.
import { createSign } from "node:crypto";
import { requestJson } from "../http";
import { PaymentError } from "../types";
import type { BankTxInput } from "./camt";

export type RevolutBizCreds = {
  mode: "test" | "live";
  clientId: string;
  privateKey: string; // PEM
  issuer: string; // Domain der OAuth-Redirect-URI
  refreshToken?: string;
  accessToken?: string;
  accessTokenExp?: string; // ms
  accountId?: string; // Revolut-Konto (UUID)
};

export const bizBase = (mode: "test" | "live") =>
  (process.env.REVOLUT_BUSINESS_BASE || (mode === "live" ? "https://b2b.revolut.com/api/1.0" : "https://sandbox-b2b.revolut.com/api/1.0")).replace(/\/$/, "");

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export function clientAssertion(c: Pick<RevolutBizCreds, "clientId" | "privateKey" | "issuer">, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: c.issuer, sub: c.clientId, aud: "https://revolut.com", exp: Math.floor(now / 1000) + 300 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(c.privateKey))}`;
}

type TokenResponse = { access_token: string; expires_in?: number; refresh_token?: string };

async function token(c: RevolutBizCreds, grant: { grant_type: "authorization_code"; code: string } | { grant_type: "refresh_token"; refresh_token: string }) {
  const body = new URLSearchParams({
    ...grant,
    client_id: c.clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: clientAssertion(c),
  });
  return requestJson<TokenResponse>(`${bizBase(c.mode)}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    secrets: [c.refreshToken, "code" in grant ? grant.code : undefined],
  });
}

/** Autorisierungscode (aus der Redirect-URL nach der Zustimmung) gegen Refresh-Token tauschen. */
export async function exchangeCode(c: RevolutBizCreds, code: string): Promise<RevolutBizCreds> {
  const t = await token(c, { grant_type: "authorization_code", code });
  if (!t.refresh_token) throw new PaymentError("Revolut hat kein Refresh-Token geliefert.");
  return { ...c, refreshToken: t.refresh_token, accessToken: t.access_token, accessTokenExp: String(Date.now() + (t.expires_in ?? 2400) * 1000) };
}

/** Gültiges Access-Token (bei Bedarf erneuert). Liefert ggf. aktualisierte Zugangsdaten zum Speichern. */
export async function ensureAccess(c: RevolutBizCreds): Promise<{ creds: RevolutBizCreds; changed: boolean }> {
  if (c.accessToken && Number(c.accessTokenExp ?? 0) > Date.now() + 60_000) return { creds: c, changed: false };
  if (!c.refreshToken) throw new PaymentError("Revolut Business: kein Refresh-Token – bitte Zustimmung erneut erteilen.");
  const t = await token(c, { grant_type: "refresh_token", refresh_token: c.refreshToken });
  return { creds: { ...c, accessToken: t.access_token, accessTokenExp: String(Date.now() + (t.expires_in ?? 2400) * 1000), refreshToken: t.refresh_token ?? c.refreshToken }, changed: true };
}

export type RevolutAccount = { id: string; name?: string; currency: string; balance?: number; state?: string };

export async function listAccounts(c: RevolutBizCreds) {
  return requestJson<RevolutAccount[]>(`${bizBase(c.mode)}/accounts`, { headers: { Authorization: `Bearer ${c.accessToken}` }, secrets: [c.accessToken] });
}

type Leg = { leg_id: string; account_id: string; amount: number; currency: string; description?: string; counterparty?: { account_id?: string; account_type?: string } };
export type RevolutTransaction = { id: string; type: string; state: string; created_at: string; completed_at?: string; reference?: string; legs: Leg[] };

/** Revolut-Umsatz → Kontoumsatz (nur abgeschlossene, nur Bein des gewählten Kontos). */
export function mapRevolutTransactions(txs: RevolutTransaction[], accountId: string): BankTxInput[] {
  const out: BankTxInput[] = [];
  for (const t of txs) {
    if (t.state !== "completed") continue;
    for (const leg of t.legs ?? []) {
      if (leg.account_id !== accountId) continue;
      const desc = leg.description?.replace(/^(Payment from|Zahlung von|To|An)\s+/i, "").trim() || null;
      out.push({
        externalId: `${t.id}:${leg.leg_id}`,
        bookingDate: (t.completed_at ?? t.created_at).slice(0, 10),
        amountCents: Math.round(leg.amount * 100),
        currency: leg.currency,
        counterparty: desc?.slice(0, 200) ?? null,
        counterpartyIbanLast4: null,
        remittance: t.reference?.slice(0, 1000) ?? null,
        endToEndId: null,
        mandateRef: null,
        isReturn: false,
        returnReason: null,
      });
    }
  }
  return out;
}

/** Umsätze ab `from` seitenweise holen (max. 1000 je Seite, Blättern über created_at). */
export async function fetchTransactions(c: RevolutBizCreds, from: Date, maxPages = 20): Promise<RevolutTransaction[]> {
  const all: RevolutTransaction[] = [];
  let to: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ from: from.toISOString(), count: "1000" });
    if (c.accountId) q.set("account", c.accountId);
    if (to) q.set("to", to);
    const batch = await requestJson<RevolutTransaction[]>(`${bizBase(c.mode)}/transactions?${q}`, { headers: { Authorization: `Bearer ${c.accessToken}` }, secrets: [c.accessToken] });
    all.push(...batch);
    if (batch.length < 1000) break;
    to = batch[batch.length - 1].created_at;
  }
  return all;
}

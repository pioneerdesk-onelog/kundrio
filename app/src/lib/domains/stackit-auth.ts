import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// STACKIT-Anmeldung für den Plattform-Zugang (Pioneerdesk-eigenes Projekt für Kunden-Zonen).
// Ablauf nach dem offiziellen SDK (stackit-sdk-go core/clients/key_flow.go): selbst signiertes JWT (RS512, kid im Header,
// Claims iss/sub/aud/jti/iat/exp) → POST tokenEndpoint (Standard https://service-account.api.stackit.cloud/token),
// application/x-www-form-urlencoded, grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, assertion=<JWT>.
// Schlüssel nur aus Datei/Env, nie aus der Datenbank.

export type ServiceAccountKey = {
  id?: string;
  credentials: { aud: string; iss: string; kid: string; privateKey?: string; sub: string; tokenEndpoint?: string };
};

export const DEFAULT_TOKEN_ENDPOINT = "https://service-account.api.stackit.cloud/token";
const GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Selbst signiertes JWT (RS512) für den Token-Tausch – rein, testbar. */
export function buildAssertion(key: ServiceAccountKey, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const c = key.credentials;
  const header = { alg: "RS512", typ: "JWT", kid: c.kid };
  const claims = { iss: c.iss, sub: c.sub, aud: c.aud, jti: randomUUID(), iat: now, exp: now + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = createSign("RSA-SHA512").update(input).sign(createPrivateKey(privateKeyPem));
  return `${input}.${b64url(sig)}`;
}

/** Ablauf (exp) eines JWT lesen, ohne Signaturprüfung – nur für den Cache. */
export function jwtExp(token: string): number | null {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof p.exp === "number" ? p.exp : null;
  } catch {
    return null;
  }
}

export function stackitPlatformConfig(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.STACKIT_DNS_PROJECT_ID?.trim() || "";
  const token = env.STACKIT_DNS_TOKEN?.trim() || "";
  const keyPath = env.STACKIT_SERVICE_ACCOUNT_KEY_PATH?.trim() || "";
  const keyJson = env.STACKIT_SERVICE_ACCOUNT_KEY?.trim() || "";
  const privateKeyPath = env.STACKIT_PRIVATE_KEY_PATH?.trim() || "";
  return { projectId, token, keyPath, keyJson, privateKeyPath, configured: Boolean(projectId && (token || keyPath || keyJson)) };
}

function loadKey(cfg: ReturnType<typeof stackitPlatformConfig>): { key: ServiceAccountKey; pem: string } {
  const raw = cfg.keyJson || readFileSync(cfg.keyPath, "utf8");
  const key = JSON.parse(raw) as ServiceAccountKey;
  if (!key?.credentials?.kid || !key.credentials.iss || !key.credentials.sub || !key.credentials.aud) throw new Error("STACKIT: Service-Account-Key unvollständig (credentials.kid/iss/sub/aud).");
  // Der private Schlüssel steckt im Key-JSON, sofern STACKIT ihn erzeugt hat; sonst separat (eigenes Schlüsselpaar)
  const pem = key.credentials.privateKey ?? (cfg.privateKeyPath ? readFileSync(cfg.privateKeyPath, "utf8") : "");
  if (!pem) throw new Error("STACKIT: Privater Schlüssel fehlt (im Key-JSON oder STACKIT_PRIVATE_KEY_PATH).");
  return { key, pem };
}

let cache: { token: string; exp: number } | null = null;

/** Access-Token für die STACKIT-APIs (zwischengespeichert, 60 s vor Ablauf erneuert). */
export async function stackitAccessToken(opts: { fetcher?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const cfg = stackitPlatformConfig(opts.env);
  if (!cfg.configured) throw new Error("STACKIT DNS ist nicht eingerichtet (STACKIT_DNS_PROJECT_ID und Service-Account-Key bzw. STACKIT_DNS_TOKEN).");
  if (cfg.token) return cfg.token; // Entwicklung: fest vorgegebenes Token
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.exp - 60 > now) return cache.token;
  const { key, pem } = loadKey(cfg);
  const endpoint = key.credentials.tokenEndpoint || DEFAULT_TOKEN_ENDPOINT;
  const body = new URLSearchParams({ grant_type: GRANT, assertion: buildAssertion(key, pem, now) });
  const res = await (opts.fetcher ?? fetch)(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`STACKIT: Token-Abruf fehlgeschlagen (HTTP ${res.status})`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("STACKIT: Antwort ohne access_token");
  const exp = jwtExp(data.access_token) ?? now + (data.expires_in ?? 600);
  cache = { token: data.access_token, exp };
  return data.access_token;
}

/** Nur für Tests: Cache leeren. */
export function resetStackitTokenCache() {
  cache = null;
}

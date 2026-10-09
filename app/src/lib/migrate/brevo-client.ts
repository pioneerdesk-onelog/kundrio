// Minimaler Lese-Client für die Brevo-API v3 (nur für den Import). Der API-Schlüssel wird nie gespeichert.

export class BrevoAuthError extends Error {}

const BASE = () => (process.env.BREVO_IMPORT_BASE_URL || "https://api.brevo.com/v3").replace(/\/$/, "");

export async function brevoGet<T>(apiKey: string, path: string, query: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(BASE() + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { "api-key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new BrevoAuthError("Brevo lehnt den API-Schlüssel ab (401/403). Bitte einen v3-REST-Schlüssel verwenden, keinen MCP-Schlüssel.");
  if (!res.ok) throw new Error(`Brevo ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export type BrevoContact = {
  email?: string;
  id?: number;
  emailBlacklisted?: boolean;
  createdAt?: string;
  modifiedAt?: string;
  attributes?: Record<string, unknown>;
  listIds?: number[];
};
export type BrevoList = { id: number; name: string };
export type BrevoAttribute = { name: string; category: string; type?: string; enumeration?: { value: number; label: string }[] };
export type BrevoBlocked = { email: string; reason?: { code?: string; message?: string }; blockedAt?: string };
export type BrevoTemplate = {
  id: number;
  name: string;
  subject?: string;
  isActive?: boolean;
  htmlContent?: string;
  sender?: { name?: string; email?: string };
  replyTo?: string;
};

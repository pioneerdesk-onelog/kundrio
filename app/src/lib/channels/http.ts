// HTTP-Hilfe für Plattform-APIs: Zeitlimit, Fehlerklassen (neu verbinden / vorübergehend), Token-Schwärzung.
// Basis-URLs sind per Env überschreibbar (Tests gegen lokale Mock-Server).
import { ReauthRequiredError, TransientChannelError } from "./types";
import { redact } from "./crypto";

export const BASES = {
  linkedinApi: () => process.env.LINKEDIN_API_BASE ?? "https://api.linkedin.com",
  linkedinAuth: () => process.env.LINKEDIN_AUTH_BASE ?? "https://www.linkedin.com",
  meta: () => process.env.META_GRAPH_BASE ?? "https://graph.facebook.com",
  metaDialog: () => process.env.META_DIALOG_BASE ?? "https://www.facebook.com",
  x: () => process.env.X_API_BASE ?? "https://api.x.com",
  tiktokApi: () => process.env.TIKTOK_API_BASE ?? "https://open.tiktokapis.com",
  tiktokAuth: () => process.env.TIKTOK_AUTH_BASE ?? "https://www.tiktok.com",
  youtube: () => process.env.YOUTUBE_API_BASE ?? "https://www.googleapis.com",
};

export type FetchOpts = { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams; secrets?: (string | null | undefined)[] };

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(opts.headers ?? {}) },
      body: opts.body,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    throw new TransientChannelError(`Plattform nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (res.ok) {
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new TransientChannelError("Antwort der Plattform ist kein gültiges JSON.");
    }
  }
  const detail = redact(text.slice(0, 300), opts.secrets ?? []);
  if (res.status === 401) throw new ReauthRequiredError(`Zugang abgelaufen oder widerrufen – bitte neu verbinden (HTTP 401).`);
  if (res.status === 403) throw new ReauthRequiredError(`Keine Berechtigung (HTTP 403): ${detail}`);
  if (res.status === 429 || res.status >= 500) throw new TransientChannelError(`Plattform vorübergehend nicht verfügbar (HTTP ${res.status}).`);
  // Meta meldet abgelaufene Tokens als 400 mit OAuthException/code 190
  if (/OAuthException|"code"\s*:\s*190|invalid_grant|access_token_invalid/i.test(text)) {
    throw new ReauthRequiredError("Zugang ungültig – bitte neu verbinden.");
  }
  throw new Error(`Plattform-Fehler (HTTP ${res.status}): ${detail}`);
}

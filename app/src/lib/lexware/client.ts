import { lexwareBaseUrl, lexwareKey } from "./config";

// HTTP-Client für die Lexware-API: höchstens 2 Anfragen/s (Vorgabe Lexware), Backoff bei 429,
// Zeitlimit, verständliche Fehler. Der Schlüssel erscheint nie in Fehlertexten oder Logs.

export class LexwareError extends Error {
  constructor(public status: number, message: string, public issues: unknown = null) {
    super(message);
  }
}

const MIN_INTERVAL_MS = 520; // < 2 Anfragen pro Sekunde
let nextSlot = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

function describe(status: number, body: unknown): string {
  const b = (body ?? {}) as { message?: string; IssueList?: { i18nKey?: string; source?: string; type?: string }[] };
  const issues = Array.isArray(b.IssueList)
    ? b.IssueList.map((i) => [i.source, i.i18nKey ?? i.type].filter(Boolean).join(": ")).join("; ")
    : "";
  const base: Record<number, string> = {
    400: "Lexware hat die Daten abgelehnt",
    401: "Lexware-Schlüssel ungültig oder abgelaufen",
    403: "Lexware verweigert den Zugriff (Tarif XL bzw. Rechte prüfen)",
    404: "In Lexware nicht gefunden",
    406: "Lexware: Format nicht akzeptiert",
    409: "Lexware: Datensatz wurde zwischenzeitlich geändert (Version)",
    429: "Lexware: zu viele Anfragen",
  };
  return `${base[status] ?? `Lexware-Fehler ${status}`}${b.message ? ` – ${b.message}` : ""}${issues ? ` (${issues})` : ""}`.slice(0, 500);
}

export async function lexwareRequest<T = unknown>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const key = lexwareKey();
  if (!key) throw new LexwareError(0, "LEXWARE_API_KEY ist nicht gesetzt.");
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await fetch(`${lexwareBaseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw new LexwareError(0, `Lexware nicht erreichbar: ${e instanceof Error && e.name === "AbortError" ? "Zeitüberschreitung" : "Netzwerkfehler"}`);
    }
    clearTimeout(timer);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text.slice(0, 200) };
    }
    if (res.ok) return data as T;
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
      continue;
    }
    throw new LexwareError(res.status, describe(res.status, data), (data as { IssueList?: unknown })?.IssueList ?? null);
  }
}

export type LexwareProfile = { organizationId: string; companyName: string; created?: unknown; taxType?: string; smallBusiness?: boolean };

export const getProfile = () => lexwareRequest<LexwareProfile>("GET", "/v1/profile");

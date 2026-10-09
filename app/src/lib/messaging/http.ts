// Kleiner HTTP-Helfer für Anbieter-APIs: Zeitlimit, JSON, Fehlertexte ohne Geheimnisse.

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export function redact(text: string, secrets: (string | undefined)[]): string {
  let t = text;
  for (const s of secrets) if (s && s.length >= 6) t = t.split(s).join("***");
  return t;
}

export async function providerFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number; secrets?: (string | undefined)[] } = {},
): Promise<{ status: number; json: unknown; text: string; headers: Headers }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "error" });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(redact(`HTTP ${res.status}: ${text.slice(0, 300)}`, init.secrets ?? []), res.status, retryable);
    }
    return { status: res.status, json, text, headers: res.headers };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Zeitüberschreitung beim Anbieter" : e.message) : String(e);
    throw new ProviderError(redact(msg, init.secrets ?? []), 0, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function providerBinary(url: string, headers: Record<string, string>, maxBytes: number, secrets: string[] = []) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: "error" });
    if (!res.ok) throw new ProviderError(redact(`HTTP ${res.status} beim Medienabruf`, secrets), res.status, res.status >= 500 || res.status === 429);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new ProviderError("Mediendatei zu groß", 413, false);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new ProviderError("Mediendatei zu groß", 413, false);
    return { data: buf, mime: res.headers.get("content-type") ?? "application/octet-stream" };
  } finally {
    clearTimeout(timer);
  }
}

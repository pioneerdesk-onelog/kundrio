// HTTP für Zahlungsanbieter: Zeitlimit, keine Weiterleitungen, Geheimnisse in Fehlermeldungen geschwärzt.
// Basis-URLs per Env überschreibbar (Tests gegen lokale Mock-Server).
import { PaymentError } from "./types";

export type RequestOpts = { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams; secrets?: (string | null | undefined)[]; timeoutMs?: number };

export function redactSecrets(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[geschwärzt]");
  return out;
}

export async function requestJson<T>(url: string, opts: RequestOpts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Accept: "application/json", ...(opts.headers ?? {}) },
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch (e) {
    throw new PaymentError(`Anbieter nicht erreichbar: ${redactSecrets(e instanceof Error ? e.message : String(e), opts.secrets ?? [])}`, 0, true);
  }
  const text = await res.text();
  if (res.ok) {
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new PaymentError("Antwort des Anbieters ist kein gültiges JSON.", res.status, true);
    }
  }
  const detail = redactSecrets(text.slice(0, 300), opts.secrets ?? []);
  if (res.status === 401 || res.status === 403) throw new PaymentError(`Zugang abgelehnt (HTTP ${res.status}) – Schlüssel prüfen.`, res.status);
  if (res.status === 429 || res.status >= 500) throw new PaymentError(`Anbieter vorübergehend nicht verfügbar (HTTP ${res.status}).`, res.status, true);
  throw new PaymentError(`Anbieter-Fehler (HTTP ${res.status}): ${detail}`, res.status);
}

/** 1234 → "12.34" (Mollie/Unzer erwarten Dezimal-Strings) */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "12.34" | 12.34 → 1234 (ohne Fließkomma-Rundungsfehler bei Strings) */
export function decimalToCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Math.round(v * 100);
  const m = /^(-)?(\d+)(?:\.(\d{1,}))?$/.exec(v.trim());
  if (!m) return Math.round(Number(v) * 100) || 0;
  const frac = (m[3] ?? "").padEnd(2, "0");
  const cents = Number(m[2]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
  return m[1] ? -cents : cents;
}

export const isHttps = (url: string) => /^https:\/\//.test(url);

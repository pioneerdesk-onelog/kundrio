// Minimaler Lese-Client für die HubSpot-API (nur für den Import). Der Zugangsschlüssel wird nie gespeichert.
// Zugang: Service Key oder (Legacy) Private-App-Token – beides als Bearer.

export class HubspotAuthError extends Error {}

const BASE = () => (process.env.HUBSPOT_IMPORT_BASE_URL || "https://api.hubapi.com").replace(/\/$/, "");

// Rate-Limit: höchstens 150 Anfragen je 10 s (HubSpot erlaubt 190 je App)
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 150;
const sent: number[] = [];

async function throttle() {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > WINDOW_MS) sent.shift();
    if (sent.length < MAX_PER_WINDOW) {
      sent.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, WINDOW_MS - (now - sent[0]) + 20));
  }
}

export async function hsGet<T>(token: string, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(BASE() + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 401) throw new HubspotAuthError("HubSpot lehnt den Zugang ab (401). Bitte Service Key bzw. Private-App-Token prüfen.");
    if (res.status === 403) {
      throw new HubspotAuthError(`HubSpot verweigert ${path} (403) – dem Schlüssel fehlt vermutlich ein Lese-Bereich (Scope).`);
    }
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(retry) && retry > 0 ? retry * 1000 : Math.min(2 ** attempt * 1000, 15_000)));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  throw new Error(`HubSpot ${path}: zu viele Wiederholungen (Rate-Limit/Serverfehler)`);
}

export type HsPage<T> = { results: T[]; paging?: { next?: { after?: string } } };
export type HsObject = { id: string; properties?: Record<string, unknown>; associations?: Record<string, { results?: { id: string | number; type?: string }[] }>; createdAt?: string; updatedAt?: string };
export type HsOwner = { id: string | number; email?: string; firstName?: string; lastName?: string };
export type HsProperty = { name: string; label: string; type: string; fieldType?: string; hubspotDefined?: boolean; calculated?: boolean; options?: { label: string; value: string }[] };
export type HsPipeline = { id: string; label: string; stages: { id: string; label: string; displayOrder?: number; metadata?: Record<string, unknown> }[] };

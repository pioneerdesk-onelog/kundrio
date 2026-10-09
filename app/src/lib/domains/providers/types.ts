import type { ZoneRecord } from "../plan";
import type { DesiredRecord } from "../types";

// Gemeinsame Schnittstelle der DNS-Anbieter-APIs. Namen immer vollqualifiziert (ohne Punkt am Ende).

export type Fetcher = typeof fetch;

export interface DnsApi {
  /** Zone (registrierbare Domain) beim Anbieter finden; wirft verständlich, wenn nicht vorhanden */
  listRecords(zone: string): Promise<ZoneRecord[]>;
  createRecord(zone: string, rec: DesiredRecord): Promise<void>;
  updateRecord(zone: string, existing: ZoneRecord, value: string, rec: DesiredRecord): Promise<void>;
  /** Nur lesender Verbindungstest */
  test(zone: string): Promise<void>;
}

export class DnsApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export async function jsonOrThrow(res: Response, provider: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? "Zugangsdaten ungültig oder ohne DNS-Berechtigung" : res.status === 404 ? "Zone nicht gefunden" : res.status === 429 ? "zu viele Anfragen – später erneut" : `HTTP ${res.status}`;
    throw new DnsApiError(`${provider}: ${hint}`, res.status);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DnsApiError(`${provider}: unerwartete Antwort`);
  }
}

/** TXT-Werte manche Anbieter mit Anführungszeichen – für Vergleiche entfernen. */
export const unquote = (v: string) => v.replace(/^"([\s\S]*)"$/, "$1").replace(/"\s*"/g, "");
export const fqdn = (rel: string, zone: string) => (rel === "@" || rel === "" ? zone : rel.endsWith(`.${zone}`) || rel === zone ? rel : `${rel}.${zone}`);

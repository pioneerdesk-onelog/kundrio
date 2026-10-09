import type { ProviderKey } from "../catalog";
import { cloudflareApi } from "./cloudflare";
import { godaddyApi } from "./godaddy";
import { hetznerApi } from "./hetzner";
import { inwxApi } from "./inwx";
import { ionosApi } from "./ionos";
import { netcupApi } from "./netcup";
import { stackitApi, stackitClient } from "./stackit";
import { stackitAccessToken, stackitPlatformConfig } from "../stackit-auth";
import { DnsApiError, type DnsApi, type Fetcher } from "./types";

export { DnsApiError };
export type { DnsApi };

/** API-Client für einen Anbieter erzeugen. Basis-URLs für Tests über Env DNS_API_BASE_<KEY> überschreibbar. */
export function apiFor(provider: ProviderKey, cred: Record<string, string>, opts: { fetcher?: Fetcher } = {}): DnsApi {
  const baseUrl = process.env[`DNS_API_BASE_${provider.toUpperCase()}`] || undefined;
  const need = (...keys: string[]) => {
    for (const k of keys) if (!cred[k]?.trim()) throw new DnsApiError(`Zugangsdaten unvollständig: ${k}`);
  };
  switch (provider) {
    case "ionos":
      need("apiKey");
      return ionosApi({ apiKey: cred.apiKey }, { baseUrl, ...opts });
    case "cloudflare":
      need("apiToken");
      return cloudflareApi({ apiToken: cred.apiToken }, { baseUrl, ...opts });
    case "hetzner":
      need("apiToken");
      return hetznerApi({ apiToken: cred.apiToken }, { baseUrl, ...opts });
    case "godaddy":
      need("apiKey", "apiSecret");
      return godaddyApi({ apiKey: cred.apiKey, apiSecret: cred.apiSecret }, { baseUrl, ...opts });
    case "inwx":
      need("user", "password");
      return inwxApi({ user: cred.user, password: cred.password }, { baseUrl, ...opts });
    case "netcup":
      need("customerNumber", "apiKey", "apiPassword");
      return netcupApi({ customerNumber: cred.customerNumber, apiKey: cred.apiKey, apiPassword: cred.apiPassword }, { baseUrl, ...opts });
    case "stackit":
      return stackitApi(platformStackitClient(opts));
    default:
      throw new DnsApiError("Für diesen Anbieter gibt es keine automatische Schnittstelle – bitte manuell einrichten.");
  }
}

/** STACKIT-Client mit Plattform-Zugang (Projekt von Pioneerdesk; Schlüssel nur aus Env/Datei). */
export function platformStackitClient(opts: { fetcher?: Fetcher } = {}) {
  const cfg = stackitPlatformConfig();
  if (!cfg.configured) throw new DnsApiError("STACKIT DNS ist nicht eingerichtet (STACKIT_DNS_PROJECT_ID und Service-Account-Key).");
  return stackitClient({ projectId: cfg.projectId, token: () => stackitAccessToken({ fetcher: opts.fetcher }), baseUrl: process.env.DNS_API_BASE_STACKIT || undefined, fetcher: opts.fetcher });
}

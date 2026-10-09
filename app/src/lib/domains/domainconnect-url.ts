// Domain Connect: reine Hilfsfunktionen (ohne Netzwerk) – testbar.

export type DcSettings = { providerId: string; providerName: string; providerDisplayName?: string; urlSyncUX?: string; urlAPI?: string };

export function templateConfig(env: NodeJS.ProcessEnv = process.env) {
  const providerId = env.DOMAIN_CONNECT_PROVIDER_ID?.trim();
  const serviceId = env.DOMAIN_CONNECT_SERVICE_ID?.trim();
  return providerId && serviceId ? { providerId, serviceId } : null;
}

/** Baut die Anwendungs-URL des synchronen Ablaufs (Variablen gemäß unserem Template). */
export function buildApplyUrl(settings: DcSettings, tpl: { providerId: string; serviceId: string }, p: { zone: string; host: string; target: string; verify: string; redirectUri?: string; state?: string }): string {
  const base = (settings.urlSyncUX ?? "").replace(/\/$/, "");
  const q = new URLSearchParams({ domain: p.zone, target: p.target, verify: p.verify });
  if (p.host && p.host !== "@") q.set("host", p.host);
  if (p.redirectUri) q.set("redirect_uri", p.redirectUri);
  if (p.state) q.set("state", p.state);
  return `${base}/v2/domainTemplates/providers/${encodeURIComponent(tpl.providerId)}/services/${encodeURIComponent(tpl.serviceId)}/apply?${q.toString()}`;
}


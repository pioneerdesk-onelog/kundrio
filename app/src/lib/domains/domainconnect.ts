import "server-only";
import { lookup } from "node:dns/promises";
import { isBlockedIp } from "../c-fetch";
import type { DnsLookup } from "./resolver";
import { buildApplyUrl, templateConfig, type DcSettings } from "./domainconnect-url";

export type { DcSettings };

// Domain Connect (https://www.domainconnect.org, Spezifikation: github.com/Domain-Connect/spec)
// Discovery: TXT _domainconnect.<zone> → Host des Anbieters → GET https://<host>/v2/<zone>/settings
// Der synchrone Ablauf funktioniert nur, wenn unser Template beim jeweiligen DNS-Anbieter eingereicht und
// freigeschaltet ist (Env DOMAIN_CONNECT_PROVIDER_ID / DOMAIN_CONNECT_SERVICE_ID).

export type DcStatus =
  | { supported: false; reason: string }
  | { supported: true; settings: DcSettings; templateReady: boolean; applyUrl?: string; reason?: string };

async function safeJson(url: string, timeoutMs = 6000): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("nur https");
  const ips = await lookup(u.hostname, { all: true });
  if (!ips.length || ips.some((a) => isBlockedIp(a.address))) throw new Error("Ziel nicht erlaubt");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: ctl.signal, redirect: "error", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 100_000) throw new Error("Antwort zu groß");
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

export async function discover(zone: string, r: DnsLookup, apply?: { host: string; target: string; verify: string; redirectUri?: string }): Promise<DcStatus> {
  const txt = await r.resolve(`_domainconnect.${zone}`, "TXT").catch((): string[] => []);
  const host = txt[0]?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host) return { supported: false, reason: "Der DNS-Anbieter meldet kein Domain Connect für diese Domain." };
  let settings: DcSettings;
  try {
    settings = (await safeJson(`https://${host}/v2/${zone}/settings`)) as DcSettings;
    if (!settings?.providerId) throw new Error("ungültige Einstellungen");
  } catch (e) {
    return { supported: false, reason: `Domain Connect-Einstellungen nicht abrufbar (${e instanceof Error ? e.message : e}).` };
  }
  const tpl = templateConfig();
  if (!tpl) return { supported: true, settings, templateReady: false, reason: "Unser Domain-Connect-Template ist noch nicht eingereicht/konfiguriert (DOMAIN_CONNECT_PROVIDER_ID/SERVICE_ID)." };
  // Prüfen, ob der Anbieter unser Template kennt
  let templateReady = false;
  if (settings.urlAPI) {
    try {
      await safeJson(`${settings.urlAPI.replace(/\/$/, "")}/v2/domainTemplates/providers/${encodeURIComponent(tpl.providerId)}/services/${encodeURIComponent(tpl.serviceId)}`);
      templateReady = true;
    } catch {
      templateReady = false;
    }
  }
  if (!templateReady) return { supported: true, settings, templateReady: false, reason: `${settings.providerDisplayName ?? settings.providerName} unterstützt Domain Connect, kennt unser Template aber (noch) nicht.` };
  return { supported: true, settings, templateReady: true, applyUrl: apply ? buildApplyUrl(settings, tpl, { zone, ...apply }) : undefined };
}

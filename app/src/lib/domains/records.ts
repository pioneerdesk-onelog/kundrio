import { isApex, registrableDomain } from "./hostname";
import type { DesiredRecord, DomainPurpose } from "./types";

// Soll-Einträge für eine eigene Domain berechnen (rein, ohne Netzwerk).

export type TargetConfig = {
  /** CNAME-Ziel für Subdomains, z. B. sites.pioneerdesk.cloud */
  cnameTarget: string;
  /** A/AAAA für die Domain-Spitze (CNAME ist an der Spitze nicht erlaubt) */
  ipv4: string[];
  ipv6: string[];
  /** Mail: SPF-Mechanismus der Versandleitung, DKIM-Selektor + Ziel, DMARC-Empfänger */
  spfInclude?: string;
  dkim?: { selector: string; target: string };
  dmarcRua?: string;
};

export function targetConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TargetConfig {
  const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const dkimSel = env.MAIL_DKIM_SELECTOR?.trim();
  const dkimTarget = env.MAIL_DKIM_TARGET?.trim();
  return {
    cnameTarget: (env.LANDING_CNAME_TARGET || "sites.pioneerdesk.cloud").trim().toLowerCase().replace(/\.$/, ""),
    ipv4: list(env.LANDING_IPV4),
    ipv6: list(env.LANDING_IPV6),
    spfInclude: env.MAIL_SPF_INCLUDE?.trim() || undefined,
    dkim: dkimSel && dkimTarget ? { selector: dkimSel, target: dkimTarget } : undefined,
    dmarcRua: env.MAIL_DMARC_RUA?.trim() || undefined,
  };
}

export const VERIFY_PREFIX = "_pd-verify";
export const verifyName = (host: string) => `${VERIFY_PREFIX}.${host}`;
export const verifyValue = (token: string) => `pd-verify=${token}`;

const TTL = 3600;

export function desiredRecords(host: string, purpose: DomainPurpose, verifyToken: string, cfg: TargetConfig, zone = registrableDomain(host)): DesiredRecord[] {
  const out: DesiredRecord[] = [{ type: "TXT", name: verifyName(host), value: verifyValue(verifyToken), ttl: TTL, purpose: "verify", match: "exact" }];
  if (purpose === "landing") {
    if (isApex(host, zone)) {
      for (const ip of cfg.ipv4) out.push({ type: "A", name: host, value: ip, ttl: TTL, purpose: "landing", match: "exact" });
      for (const ip of cfg.ipv6) out.push({ type: "AAAA", name: host, value: ip, ttl: TTL, purpose: "landing", match: "exact" });
    } else {
      out.push({ type: "CNAME", name: host, value: cfg.cnameTarget, ttl: TTL, purpose: "landing", match: "exact" });
    }
  } else {
    if (cfg.spfInclude) out.push({ type: "TXT", name: host, value: `v=spf1 include:${cfg.spfInclude} ~all`, ttl: TTL, purpose: "spf", match: "contains" });
    if (cfg.dkim) out.push({ type: "CNAME", name: `${cfg.dkim.selector}._domainkey.${host}`, value: cfg.dkim.target, ttl: TTL, purpose: "dkim", match: "exact" });
    out.push({
      type: "TXT",
      name: `_dmarc.${host}`,
      value: `v=DMARC1; p=quarantine; adkim=r; aspf=r${cfg.dmarcRua ? `; rua=mailto:${cfg.dmarcRua}` : ""}`,
      ttl: TTL,
      purpose: "dmarc",
      match: "prefix",
    });
  }
  return out;
}

/** Was gilt als „passt“: SPF enthält den include, DMARC beginnt mit v=DMARC1, sonst exakt. */
export function valueMatches(rec: Pick<DesiredRecord, "type" | "value" | "match" | "purpose">, found: string): boolean {
  const norm = (v: string) => v.trim().replace(/\.$/, "").toLowerCase();
  if (rec.purpose === "spf") {
    const inc = rec.value.match(/include:(\S+)/)?.[1];
    return norm(found).startsWith("v=spf1") && (!inc || norm(found).includes(`include:${inc.toLowerCase()}`));
  }
  if (rec.purpose === "dmarc") return norm(found).startsWith("v=dmarc1");
  if (rec.match === "contains") return norm(found).includes(norm(rec.value));
  if (rec.match === "prefix") return norm(found).startsWith(norm(rec.value));
  return norm(found) === norm(rec.value);
}

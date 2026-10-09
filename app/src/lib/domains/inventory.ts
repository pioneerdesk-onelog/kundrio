import type { ZoneRecord } from "./plan";
import type { DnsLookup, LookupType } from "./resolver";

// Ist-Bestand einer Zone vor dem Umzug zu STACKIT DNS ermitteln – als Übernahme-Liste, die ein Mensch prüft.
// Ohne Zugriff auf die Zone beim bisherigen Anbieter können wir nur bekannte Namen abfragen:
// unbekannte Subdomains fehlen dann und müssen ergänzt werden (wird deutlich angezeigt).

export type InventoryItem = {
  type: string; // A | AAAA | CNAME | MX | TXT | SRV | CAA
  name: string; // vollqualifiziert, ohne Punkt am Ende
  values: string[];
  ttl: number;
  source: "dns" | "api" | "manual";
  include: boolean;
  note?: string;
};

export const IMPORTABLE_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA"] as const;

/** Gängige Hostnamen (relativ zur Zone), die per DNS abgefragt werden. */
export const COMMON_HOSTS = [
  "www", "mail", "webmail", "smtp", "imap", "pop", "autodiscover", "autoconfig", "lyncdiscover", "sip",
  "enterpriseregistration", "enterpriseenrollment", "msoid", "owa", "ftp", "shop", "blog", "app", "api",
  "portal", "cloud", "intranet", "vpn", "remote", "status", "docs", "help", "support", "news", "newsletter",
  "em", "email", "links", "click", "track", "go", "info", "service", "kunden", "login", "auth", "cdn", "static", "assets",
];
export const DKIM_SELECTORS = ["selector1", "selector2", "google", "default", "dkim", "k1", "k2", "k3", "s1", "s2", "mail", "brevo1", "brevo2", "mailjet", "mandrill", "sendgrid", "smtp", "pm", "zoho", "protonmail", "protonmail2", "protonmail3", "mxvault"];
export const SRV_NAMES = ["_sip._tls", "_sipfederationtls._tcp", "_autodiscover._tcp", "_submission._tcp", "_imaps._tcp", "_pop3s._tcp", "_caldavs._tcp", "_carddavs._tcp", "_xmpp-client._tcp", "_xmpp-server._tcp"];

const DEFAULT_TTL = 3600;

async function q(r: DnsLookup, host: string, type: LookupType): Promise<string[]> {
  try {
    return await r.resolve(host, type);
  } catch {
    return [];
  }
}

/** Bestand per DNS-Abfragen (ein Resolver genügt; Antworten des autoritativen Bestands). */
export async function inventoryFromDns(zone: string, r: DnsLookup): Promise<{ items: InventoryItem[]; warnings: string[] }> {
  const items: InventoryItem[] = [];
  const add = (type: string, name: string, values: string[], note?: string) => {
    if (values.length) items.push({ type, name, values: Array.from(new Set(values)), ttl: DEFAULT_TTL, source: "dns", include: true, note });
  };

  // Domain-Spitze (kein CNAME erlaubt)
  add("A", zone, await q(r, zone, "A"));
  add("AAAA", zone, await q(r, zone, "AAAA"));
  add("MX", zone, await q(r, zone, "MX"));
  add("TXT", zone, await q(r, zone, "TXT"), "u. a. SPF und Verifizierungen (Google, Microsoft …)");
  add("CAA", zone, await q(r, zone, "CAA"), "erlaubte Zertifizierungsstellen");

  for (const h of COMMON_HOSTS) {
    const name = `${h}.${zone}`;
    const cname = await q(r, name, "CNAME");
    if (cname.length) {
      add("CNAME", name, cname);
      continue; // neben einem CNAME gibt es keine weiteren Einträge
    }
    add("A", name, await q(r, name, "A"));
    add("AAAA", name, await q(r, name, "AAAA"));
    add("MX", name, await q(r, name, "MX"));
    add("TXT", name, await q(r, name, "TXT"));
  }

  add("TXT", `_dmarc.${zone}`, await q(r, `_dmarc.${zone}`, "TXT"), "DMARC-Richtlinie");
  for (const sel of DKIM_SELECTORS) {
    const name = `${sel}._domainkey.${zone}`;
    const cname = await q(r, name, "CNAME");
    if (cname.length) add("CNAME", name, cname, "DKIM (delegiert)");
    else add("TXT", name, await q(r, name, "TXT"), "DKIM-Schlüssel");
  }
  for (const s of SRV_NAMES) add("SRV", `${s}.${zone}`, await q(r, `${s}.${zone}`, "SRV"));

  const warnings = [
    "Diese Liste beruht auf DNS-Abfragen bekannter Namen. Weitere Subdomains (z. B. intern genutzte Namen) sind darin nicht enthalten – bitte beim bisherigen Anbieter die vollständige Zonenliste prüfen und fehlende Einträge unten ergänzen.",
  ];
  if (!items.some((i) => i.type === "MX")) warnings.push("Kein MX-Eintrag gefunden – falls die Domain E-Mails empfängt, unbedingt prüfen.");
  return { items, warnings };
}

/** Bestand aus der API des bisherigen Anbieters (vollständig; NS/SOA der Spitze werden nicht übernommen). */
export function inventoryFromApi(zone: string, recs: ZoneRecord[]): { items: InventoryItem[]; warnings: string[] } {
  const groups = new Map<string, InventoryItem>();
  const skipped = new Set<string>();
  for (const r of recs) {
    const type = r.type.toUpperCase();
    const name = r.name.toLowerCase().replace(/\.$/, "");
    if ((type === "NS" || type === "SOA") && name === zone) continue;
    if (!(IMPORTABLE_TYPES as readonly string[]).includes(type) && type !== "NS") {
      skipped.add(type);
      continue;
    }
    const key = `${type} ${name}`;
    const g = groups.get(key) ?? { type, name, values: [], ttl: r.ttl ?? DEFAULT_TTL, source: "api" as const, include: true, note: type === "NS" ? "Delegation einer Unterzone" : undefined };
    if (!g.values.includes(r.value)) g.values.push(r.value);
    groups.set(key, g);
  }
  const warnings = skipped.size ? [`Nicht automatisch übernommen (Typ): ${[...skipped].join(", ")} – bitte manuell prüfen.`] : [];
  return { items: [...groups.values()], warnings };
}

/** Manuell ergänzte Zeilen im Format „name TYP wert“ (name relativ, @ = Domain-Spitze). */
export function parseManualLines(zone: string, text: string): { items: InventoryItem[]; errors: string[] } {
  const items: InventoryItem[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith(";") || t.startsWith("#")) return;
    const m = t.match(/^(\S+)\s+(?:(\d+)\s+)?(?:IN\s+)?([A-Za-z]+)\s+(.+)$/);
    if (!m) return void errors.push(`Zeile ${i + 1}: Format „name TYP wert“ erwartet`);
    const type = m[3].toUpperCase();
    if (!(IMPORTABLE_TYPES as readonly string[]).includes(type)) return void errors.push(`Zeile ${i + 1}: Typ ${type} wird nicht unterstützt`);
    const rel = m[1].replace(/\.$/, "");
    const name = rel === "@" ? zone : rel.endsWith(`.${zone}`) || rel === zone ? rel.toLowerCase() : `${rel}.${zone}`.toLowerCase();
    let value = m[4].trim();
    if (type === "TXT") value = value.replace(/^"([\s\S]*)"$/, "$1");
    items.push({ type, name, values: [value], ttl: m[2] ? Number(m[2]) : DEFAULT_TTL, source: "manual", include: true });
  });
  return { items, errors };
}

/** Gleiche (Name, Typ)-Gruppen zusammenführen. */
export function mergeItems(...lists: InventoryItem[][]): InventoryItem[] {
  const map = new Map<string, InventoryItem>();
  for (const it of lists.flat()) {
    const k = `${it.type} ${it.name}`;
    const g = map.get(k);
    if (!g) map.set(k, { ...it, values: [...it.values] });
    else for (const v of it.values) if (!g.values.includes(v)) g.values.push(v);
  }
  return [...map.values()];
}

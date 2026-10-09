// Strukturierte Daten aus dem ausgelieferten HTML: schema.org JSON-LD (Organization/LocalBusiness/Corporation)
// und Meta-Beschreibungen. Wichtig für Single-Page-Apps, deren sichtbarer Inhalt erst per JavaScript entsteht.

export type StructuredData = {
  name?: string;
  legalName?: string;
  url?: string;
  telephone?: string;
  email?: string;
  address?: string;
  vatId?: string;
  description?: string;
  sameAs: string[];
};

const ORG_TYPES = /^(Organization|Corporation|LocalBusiness|ProfessionalService|Store|Company|OnlineBusiness|NGO|EducationalOrganization|GovernmentOrganization)$/i;

function flatten(node: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    out.push(o);
    if (o["@graph"]) flatten(o["@graph"], out);
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined);
const types = (o: Record<string, unknown>) => (Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]).map(String);

function address(v: unknown): string | undefined {
  const a = Array.isArray(v) ? v[0] : v;
  if (typeof a === "string") return str(a);
  if (!a || typeof a !== "object") return undefined;
  const o = a as Record<string, unknown>;
  const street = str(o.streetAddress);
  const city = [str(o.postalCode), str(o.addressLocality)].filter(Boolean).join(" ");
  return street && city ? `${street}\n${city}` : undefined;
}

export function parseStructured(html: string): StructuredData {
  const out: StructuredData = { sameAs: [] };
  const nodes: Record<string, unknown>[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      flatten(JSON.parse(m[1].trim()), nodes);
    } catch {
      // ungültiges JSON-LD ignorieren
    }
  }
  const org = nodes.find((n) => types(n).some((t) => ORG_TYPES.test(t)));
  if (org) {
    out.name = str(org.name);
    out.legalName = str(org.legalName);
    out.url = str(org.url);
    out.telephone = str(org.telephone);
    out.email = str(org.email)?.replace(/^mailto:/i, "").toLowerCase();
    out.address = address(org.address);
    out.vatId = str(org.vatID ?? org.taxID)?.replace(/\s/g, "").toUpperCase();
    out.description = str(org.description);
    const same = Array.isArray(org.sameAs) ? org.sameAs : org.sameAs ? [org.sameAs] : [];
    out.sameAs = same.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s)).slice(0, 20);
  }
  if (!out.description) {
    const meta =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,600})["']/i) ??
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,600})["']/i);
    if (meta) out.description = meta[1].trim();
  }
  return out;
}

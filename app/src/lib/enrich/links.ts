// Link-Auswertung von Firmen-Websites: Impressum/Kontakt/Team finden, Social-Profile erkennen.
// Rein funktional (testbar ohne Netz).

export type Link = { href: string; text: string };

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function extractLinks(html: string, baseUrl: string): Link[] {
  const out: Link[] = [];
  const re = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = decode((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(javascript|data):/i.test(raw)) continue;
    try {
      const href = new URL(raw, baseUrl).toString();
      const text = decode(m[5].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      out.push({ href, text });
    } catch {
      // ungültige URL ignorieren
    }
  }
  return out;
}

const sameSite = (href: string, base: string) => {
  try {
    const a = new URL(href).hostname.replace(/^www\./, "");
    const b = new URL(base).hostname.replace(/^www\./, "");
    return a === b;
  } catch {
    return false;
  }
};

const KINDS = {
  impressum: { text: /\b(impressum|imprint|legal notice|anbieterkennzeichnung)\b/i, path: /(impressum|imprint|legal-notice|anbieterkennzeichnung)/i },
  contact: { text: /\b(kontakt|contact)\b/i, path: /\/(kontakt|contact)(\/|$|\.)/i },
  about: { text: /\b(über uns|ueber uns|about( us)?|unternehmen|wir über uns)\b/i, path: /\/(ueber-uns|uber-uns|about|about-us|unternehmen|company)(\/|$|\.)/i },
  team: { text: /\b(team|ansprechpartner|management|geschäftsleitung|leadership)\b/i, path: /\/(team|ansprechpartner|management|leadership)(\/|$|\.)/i },
} as const;
export type PageKind = keyof typeof KINDS;

/** Interne Seiten nach Art, beste Treffer zuerst (max. je Art 2). */
export function findPages(links: Link[], baseUrl: string): Record<PageKind, string[]> {
  const res = { impressum: [], contact: [], about: [], team: [] } as Record<PageKind, string[]>;
  for (const kind of Object.keys(KINDS) as PageKind[]) {
    const { text, path } = KINDS[kind];
    const hits = links
      .filter((l) => sameSite(l.href, baseUrl))
      .map((l) => ({ href: l.href.split("#")[0], score: (text.test(l.text) ? 2 : 0) + (path.test(new URL(l.href).pathname) ? 1 : 0) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);
    res[kind] = Array.from(new Set(hits.map((h) => h.href))).slice(0, 2);
  }
  return res;
}

/** Typische Impressum-Pfade, falls kein Link gefunden wurde. */
export function fallbackImpressumUrls(baseUrl: string): string[] {
  const o = new URL(baseUrl).origin;
  return [`${o}/impressum`, `${o}/impressum/`, `${o}/imprint`, `${o}/de/impressum`];
}

const SOCIAL: { net: string; re: RegExp }[] = [
  { net: "linkedin", re: /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|school|showcase)\/[^/?#]+/i },
  { net: "xing", re: /^https?:\/\/(www\.)?xing\.com\/(pages|companies)\/[^/?#]+/i },
  { net: "instagram", re: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|explore\/)[A-Za-z0-9_.]+\/?$/i },
  { net: "facebook", re: /^https?:\/\/(www\.|de-de\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[^/?#]+\/?$/i },
  { net: "youtube", re: /^https?:\/\/(www\.)?youtube\.com\/(@[^/?#]+|c\/[^/?#]+|channel\/[^/?#]+|user\/[^/?#]+)/i },
  { net: "x", re: /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home)[A-Za-z0-9_]+\/?$/i },
  { net: "tiktok", re: /^https?:\/\/(www\.)?tiktok\.com\/@[^/?#]+/i },
  { net: "github", re: /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/i },
  { net: "kununu", re: /^https?:\/\/(www\.)?kununu\.com\/[a-z]{2}\/[^/?#]+/i },
];

/** Social-Profile des Unternehmens (nur Links, keine Inhalte). Erster Treffer je Netzwerk. */
export function detectSocialLinks(links: Link[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of links) {
    const href = l.href.split("?")[0].replace(/\/+$/, "");
    for (const s of SOCIAL) {
      if (!out[s.net] && (s.re.test(href) || s.re.test(`${href}/`))) out[s.net] = href;
    }
  }
  return out;
}

/** Ist das ein berufliches Personenprofil (für Kontakte)? */
export function professionalProfileNet(url: string): "linkedin" | "xing" | null {
  if (/^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+/i.test(url)) return "linkedin";
  if (/^https?:\/\/(www\.)?xing\.com\/profile\/[^/?#]+/i.test(url)) return "xing";
  return null;
}

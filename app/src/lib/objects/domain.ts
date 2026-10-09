// Domain-Normalisierung und Freemail-Erkennung (rein, ohne DB) – für die Zuordnung Kontakt → Unternehmen.

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "gmx.com", "web.de", "t-online.de", "outlook.com", "outlook.de",
  "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com", "yahoo.com", "yahoo.de", "ymail.com", "icloud.com", "me.com", "mac.com",
  "posteo.de", "posteo.net", "mailbox.org", "freenet.de", "aol.com", "aol.de", "proton.me", "protonmail.com", "pm.me", "tutanota.com",
  "tuta.io", "arcor.de", "online.de", "email.de", "vodafone.de", "kabelmail.de", "1und1.de", "bluewin.ch", "gmx.li", "mail.de",
  "zoho.com", "yandex.com", "mail.ru", "duck.com",
]);

/** "https://www.Example.de/pfad" → "example.de"; ungültig → null */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^[^@/]*@/, "");
  s = s.split(/[/?#:]/)[0].replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  return s;
}

/** Domain aus E-Mail-Adresse */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return normalizeDomain(email.split("@").pop() ?? "");
}

export function isFreemail(domain: string | null | undefined): boolean {
  return !!domain && FREEMAIL.has(domain.toLowerCase());
}

/** Vorschlag für einen Firmennamen aus der Domain: "pioneer-desk.de" → "Pioneer Desk" */
export function nameFromDomain(domain: string): string {
  const base = domain.split(".").slice(0, -1).join(" ") || domain;
  return base
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

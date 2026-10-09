// Host-basiertes Routing für eigene Domains – rein, ohne DB (Middleware + Tests).

/** Pfade, die auf eigenen Domains NICHT umgeschrieben werden (Plattform-Funktionen: Beacon, Formulare, Assets). */
const PASS_THROUGH = /^\/(_next|api|favicon\.ico|\.well-known|_vercel)(\/|$)/;

export const DOMAIN_ROUTE_PREFIX = "/d";

export function appHostsFrom(env: { APP_URL?: string; APP_HOSTS?: string }): string[] {
  const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
  try {
    if (env.APP_URL) hosts.add(new URL(env.APP_URL).hostname.toLowerCase());
  } catch {
    // ungültige APP_URL – ignorieren
  }
  for (const h of (env.APP_HOSTS ?? "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return [...hosts];
}

export function hostOf(rawHost: string | null): string {
  return (rawHost ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/**
 * Gibt den internen Pfad zurück, wenn die Anfrage zu einer eigenen Kundendomain gehört, sonst null.
 * Beispiel: host „angebot.kunde.de“, pathname „/sommer“ → „/d/angebot.kunde.de/sommer“.
 */
export function domainRewritePath(host: string, pathname: string, appHosts: string[]): string | null {
  if (!host || appHosts.includes(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return null;
  if (PASS_THROUGH.test(pathname)) return null;
  if (pathname.startsWith(`${DOMAIN_ROUTE_PREFIX}/`)) return null; // nie doppelt umschreiben
  return `${DOMAIN_ROUTE_PREFIX}/${host}${pathname === "/" ? "" : pathname}`;
}

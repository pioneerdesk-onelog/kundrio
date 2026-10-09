// Redirect-URIs: nur https oder localhost/Loopback (MCP-Spezifikation: „MUST be either localhost or use HTTPS“).
// Abgleich exakt; bei Loopback-IP-Adressen ist der Port variabel (RFC 8252 Abs. 7.3, OAuth 2.1).

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

export function isLoopback(uri: string) {
  const u = parse(uri);
  return !!u && LOOPBACK.has(u.hostname.toLowerCase()) ;
}

/** Prüfung bei Registrierung bzw. Client-Metadaten. Liefert Fehlertext oder null. */
export function redirectUriProblem(uri: string): string | null {
  if (typeof uri !== "string" || uri.length > 2000) return "Redirect-URI zu lang oder ungültig";
  const u = parse(uri);
  if (!u) return "Redirect-URI ist keine absolute URL";
  if (u.hash) return "Redirect-URI darf kein Fragment enthalten";
  if (u.username || u.password) return "Redirect-URI darf keine Zugangsdaten enthalten";
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname.toLowerCase())) return null;
  return "Nur https- oder localhost-Redirect-URIs sind erlaubt";
}

/** Exakter Abgleich gegen registrierte URIs (Port bei Loopback flexibel). */
export function matchRedirect(registered: string[], requested: string): boolean {
  const r = parse(requested);
  if (!r || redirectUriProblem(requested)) return false;
  return registered.some((reg) => {
    if (reg === requested) return true;
    const g = parse(reg);
    if (!g) return false;
    const loop = LOOPBACK.has(g.hostname.toLowerCase()) && g.hostname.toLowerCase() === r.hostname.toLowerCase() && g.hostname !== "localhost";
    return loop && g.protocol === r.protocol && g.pathname === r.pathname && g.search === r.search;
  });
}

/** Für die Zustimmungsseite: Host deutlich anzeigen. */
export function redirectHost(uri: string) {
  const u = parse(uri);
  return u ? u.host : uri;
}

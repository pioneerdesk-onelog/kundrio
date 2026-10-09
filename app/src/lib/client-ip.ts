// Ermittelt die Client-IP hinter Reverse-Proxys.
// TRUST_PROXY = Anzahl vertrauenswürdiger Proxys vor der App (z. B. 1 für Caddy/Ingress).
// Der Proxy hängt die echte Client-IP ans ENDE von X-Forwarded-For; alles davor kann der Client fälschen.
// Daher zählen wir von rechts: bei N vertrauenswürdigen Proxys ist der N-te Eintrag von rechts der Client.
// Ohne TRUST_PROXY: in Entwicklung 1 (lokaler Betrieb), in Produktion 0 → keine Header-IP (sicherer Standard).

export function trustedProxyCount(): number {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === "") return process.env.NODE_ENV === "production" ? 0 : 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 0;
}

export function clientIp(h: Headers, trust = trustedProxyCount()): string {
  if (trust <= 0) return "unbekannt";
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const ip = parts[parts.length - trust];
    if (ip && ip.length <= 64) return ip;
  }
  const real = h.get("x-real-ip")?.trim();
  return real && real.length <= 64 ? real : "unbekannt";
}

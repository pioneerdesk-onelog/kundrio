// Hostnamen prüfen und normalisieren (ohne DB, ohne Netzwerk) – auch im Client nutzbar.

/** Mehrteilige öffentliche Endungen, die für DACH-Kunden relevant sind (kein vollständiges PSL). */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ac.at", "co.at", "or.at", "gv.at", "com.de", "co.de", "com.au", "co.nz", "com.br", "co.jp", "com.tr", "com.pl", "co.za",
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Normalisiert Eingaben wie „https://Angebot.Kunde.de/pfad“ → „angebot.kunde.de“. Gibt null bei ungültigen Namen. */
export function normalizeHostname(input: string): string | null {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, "").split("/")[0].split("?")[0].split("#")[0];
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h || h.length > 253 || !h.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return null; // keine IP-Adressen
  const labels = h.split(".");
  if (labels.some((l) => !LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  if (labels.length < 2) return null;
  return h;
}

/** Registrierbare Domain (Zonen-Spitze nach Heuristik): „angebot.kunde.de“ → „kunde.de“. */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  const last2 = labels.slice(-2).join(".");
  if (labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(last2)) return labels.slice(-3).join(".");
  return last2;
}

export function isApex(host: string, zone = registrableDomain(host)): boolean {
  return host === zone;
}

/** Name relativ zur Zone, z. B. „angebot“ bzw. „@“ für die Spitze, „_pd-verify.angebot“. */
export function relativeName(fqdn: string, zone: string): string {
  if (fqdn === zone) return "@";
  return fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -(zone.length + 1)) : fqdn;
}

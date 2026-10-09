// Katalog der DNS-Anbieter: Erkennung an Nameservern, Automatisierungs-Möglichkeiten, Anleitung.
// Stand der Recherche: 07.10.2026 (Quellen im Bericht/Wiki). Ohne öffentliche API → nur manuell.

export type ProviderKey =
  | "ionos" | "webde" | "gmx" | "godaddy" | "cloudflare" | "hetzner" | "inwx" | "netcup" | "strato" | "allinkl"
  | "udag" | "hosteurope" | "squarespace" | "route53" | "ovh" | "stackit" | "unknown";

export type ProviderInfo = {
  key: ProviderKey;
  name: string;
  /** Automatik per API, die wir umsetzen */
  api: boolean;
  /** Anbieter unterstützt laut domainconnect.org Domain Connect (Discovery entscheidet im Einzelfall) */
  domainConnect: boolean;
  /** Welche Zugangsdaten der Kunde für die API eingibt */
  apiFields?: { key: string; label: string; secret: boolean; help?: string }[];
  apiHelp?: string;
  /** Zugang über das Pioneerdesk-Plattformprojekt (keine Kundenschlüssel), z. B. STACKIT DNS */
  platformManaged?: boolean;
};

export const PROVIDERS: Record<ProviderKey, ProviderInfo> = {
  ionos: {
    key: "ionos", name: "IONOS", api: true, domainConnect: true,
    apiFields: [{ key: "apiKey", label: "API-Schlüssel (Präfix.Geheimnis)", secret: true, help: "developer.hosting.ionos.de → API-Schlüssel erstellen; Format „präfix.geheimnis“" }],
    apiHelp: "IONOS Developer API (DNS). Schlüssel unter developer.hosting.ionos.de/keys anlegen.",
  },
  webde: { key: "webde", name: "WEB.DE", api: false, domainConnect: false },
  gmx: { key: "gmx", name: "GMX", api: false, domainConnect: false },
  godaddy: {
    key: "godaddy", name: "GoDaddy", api: true, domainConnect: true,
    apiFields: [
      { key: "apiKey", label: "API Key", secret: false },
      { key: "apiSecret", label: "API Secret", secret: true },
    ],
    apiHelp: "developer.godaddy.com → Production-Key. DNS-API seit 04/2026 ab einer Domain im Konto verfügbar.",
  },
  cloudflare: {
    key: "cloudflare", name: "Cloudflare", api: true, domainConnect: true,
    apiFields: [{ key: "apiToken", label: "API-Token (Berechtigung Zone → DNS → Bearbeiten, nur diese Zone)", secret: true }],
    apiHelp: "dash.cloudflare.com → Profil → API-Tokens → Vorlage „DNS bearbeiten“, auf die Zone beschränken.",
  },
  hetzner: {
    key: "hetzner", name: "Hetzner", api: true, domainConnect: false,
    apiFields: [{ key: "apiToken", label: "Cloud-API-Token (Lesen & Schreiben, Projekt mit der DNS-Zone)", secret: true }],
    apiHelp: "Hetzner Console → Projekt → Sicherheit → API-Tokens. Die alte DNS-API (dns.hetzner.com) ist seit 05/2026 abgeschaltet.",
  },
  inwx: {
    key: "inwx", name: "INWX", api: true, domainConnect: false,
    apiFields: [
      { key: "user", label: "Benutzername", secret: false },
      { key: "password", label: "Passwort", secret: true, help: "Empfehlung: eigener API-Unterbenutzer nur mit DNS-Rechten, ohne 2FA" },
    ],
    apiHelp: "INWX Domrobot (JSON-RPC).",
  },
  netcup: {
    key: "netcup", name: "netcup", api: true, domainConnect: false,
    apiFields: [
      { key: "customerNumber", label: "Kundennummer", secret: false },
      { key: "apiKey", label: "API-Key", secret: false },
      { key: "apiPassword", label: "API-Passwort", secret: true },
    ],
    apiHelp: "Customer Control Panel → Stammdaten → API.",
  },
  strato: { key: "strato", name: "STRATO", api: false, domainConnect: false },
  allinkl: { key: "allinkl", name: "ALL-INKL.COM", api: false, domainConnect: false },
  udag: { key: "udag", name: "united-domains", api: false, domainConnect: false },
  hosteurope: { key: "hosteurope", name: "Host Europe", api: false, domainConnect: false },
  squarespace: { key: "squarespace", name: "Squarespace (ehem. Google Domains)", api: false, domainConnect: true },
  route53: { key: "route53", name: "Amazon Route 53", api: false, domainConnect: false },
  ovh: { key: "ovh", name: "OVHcloud", api: false, domainConnect: false },
  stackit: {
    key: "stackit", name: "STACKIT DNS", api: true, domainConnect: false, platformManaged: true,
    apiHelp: "Zone liegt im STACKIT-Projekt von Pioneerdesk (Rechenzentren in Deutschland). Einträge verwaltet die Plattform – keine Zugangsdaten nötig.",
  },
  unknown: { key: "unknown", name: "Unbekannter Anbieter", api: false, domainConnect: false },
};

const NS_PATTERNS: [RegExp, ProviderKey][] = [
  // STACKIT DNS: ns1.stackit.cloud, ns2.stackit.zone (ältere Namen ns*.stackit.dns)
  [/^ns\d*\.stackit\.(cloud|zone|dns)$/, "stackit"],
  [/(^|\.)ns-webde\.ui-dns\./, "webde"],
  [/(^|\.)ns-gmx\.ui-dns\./, "gmx"],
  [/(^|\.)ui-dns\.(de|com|org|biz)$/, "ionos"],
  [/(^|\.)domaincontrol\.com$/, "godaddy"],
  [/(^|\.)ns\.cloudflare\.com$/, "cloudflare"],
  [/(^|\.)ns\.hetzner\.(com|de)$/, "hetzner"],
  [/(^|\.)(first-ns\.de|second-ns\.de|second-ns\.com|robotns\d?\.de)$/, "hetzner"],
  [/(^|\.)inwx\.(de|eu|net|ch|at)$/, "inwx"],
  [/(^|\.)(root|second|third)-dns\.netcup\.net$/, "netcup"],
  [/(^|\.)rzone\.de$/, "strato"],
  [/(^|\.)kasserver\.com$/, "allinkl"],
  [/(^|\.)udag\.(de|net|org)$/, "udag"],
  [/(^|\.)hosteurope\.(de|com)$/, "hosteurope"],
  [/(^|\.)(googledomains\.com|squarespacedns\.com)$/, "squarespace"],
  [/(^|\.)awsdns-\d+\./, "route53"],
  [/(^|\.)ovh\.(net|com|de)$/, "ovh"],
];

/** Anbieter aus Nameservern erkennen (Mehrheit gewinnt). */
export function detectProvider(nameservers: string[]): ProviderInfo {
  const votes = new Map<ProviderKey, number>();
  for (const raw of nameservers) {
    const ns = raw.toLowerCase().replace(/\.$/, "");
    const hit = NS_PATTERNS.find(([re]) => re.test(ns));
    if (hit) votes.set(hit[1], (votes.get(hit[1]) ?? 0) + 1);
  }
  let best: ProviderKey = "unknown";
  let n = 0;
  for (const [k, v] of votes) if (v > n) [best, n] = [k, v];
  return PROVIDERS[best];
}

import type { ProviderKey } from "./catalog";

// Schritt-für-Schritt-Anleitungen für die manuelle Einrichtung (Stand 10/2026; Menüpfade können sich ändern).

const GENERIC = [
  "Melden Sie sich beim Anbieter Ihrer Domain an und öffnen Sie die DNS-Verwaltung der Domain.",
  "Legen Sie die unten aufgeführten Einträge genau so an (Typ, Name, Wert). TTL: Standard bzw. 1 Stunde.",
  "Löschen Sie keine bestehenden Einträge, außer ein Konflikt wird ausdrücklich angezeigt.",
  "Speichern Sie die Änderungen. Wir prüfen automatisch; die Verbreitung dauert meist 5–60 Minuten, selten bis 48 Stunden.",
];

export const GUIDES: Partial<Record<ProviderKey, { title: string; steps: string[]; note?: string }>> = {
  ionos: {
    title: "IONOS",
    steps: [
      "Unter ionos.de anmelden → „Domains & SSL“ → Domain auswählen → Reiter „DNS“.",
      "„Record hinzufügen“ → Typ wählen (CNAME/TXT/A) → bei „Hostname“ nur den Teil vor Ihrer Domain eintragen (z. B. „angebot“; für die Domain selbst „@“).",
      "Wert eintragen, TTL „1 Stunde“, speichern. Bei CNAME: Ein bestehender A-Eintrag für denselben Hostnamen muss vorher gelöscht werden.",
    ],
    note: "Schneller: API-Schlüssel unter developer.hosting.ionos.de anlegen und hier „Automatisch per API“ wählen.",
  },
  webde: {
    title: "WEB.DE",
    steps: [
      "Unter web.de anmelden → „Domain“ (bzw. „Meine Domains“) → Domain auswählen → „DNS-Einstellungen“ / „Erweiterte Einstellungen“.",
      "Einträge mit „Eintrag hinzufügen“ anlegen. Für Subdomains zuerst die Subdomain (z. B. „angebot“) anlegen und dann deren CNAME-Ziel setzen.",
      "Falls nur eine „Weiterleitung“ angeboten wird: diese NICHT nutzen – wir benötigen einen CNAME- bzw. A-Eintrag.",
    ],
    note: "WEB.DE bietet keine öffentliche DNS-Schnittstelle – Einrichtung nur manuell. Fehlen erweiterte DNS-Einstellungen im Tarif, hilft ein Umzug der Domain zu einem Anbieter mit DNS-Verwaltung.",
  },
  gmx: {
    title: "GMX",
    steps: ["Unter gmx.net anmelden → „Domain“ → Domain auswählen → „DNS-Einstellungen“.", "Einträge wie unten anlegen und speichern."],
    note: "GMX bietet keine öffentliche DNS-Schnittstelle – nur manuell.",
  },
  godaddy: {
    title: "GoDaddy",
    steps: ["Unter godaddy.com anmelden → „Meine Produkte“ → Domain → „DNS“ → „Hinzufügen“.", "Typ, Name (ohne Domain, „@“ für die Domain selbst) und Wert eintragen, speichern."],
    note: "Alternativ automatisch per API (developer.godaddy.com, Production-Key).",
  },
  strato: {
    title: "STRATO",
    steps: [
      "Unter strato.de anmelden → „Domains“ → „Domainverwaltung“ → Zahnrad der (Sub-)Domain → „DNS“.",
      "Für Subdomains zuerst die Subdomain anlegen, dann „CNAME-Record“ verwalten bzw. „TXT- und CNAME-Records“ → Eintrag hinzufügen.",
    ],
    note: "STRATO bietet keine DNS-API – nur manuell.",
  },
  cloudflare: {
    title: "Cloudflare",
    steps: ["dash.cloudflare.com → Domain → „DNS“ → „Records“ → „Add record“.", "Bei CNAME den Proxy-Status auf „DNS only“ (graue Wolke) stellen, sonst kann kein Zertifikat ausgestellt werden."],
    note: "Alternativ automatisch per API-Token (Vorlage „DNS bearbeiten“, auf die Zone beschränkt).",
  },
  hetzner: {
    title: "Hetzner",
    steps: ["Hetzner Console → Projekt → „DNS“ → Zone → „Eintrag hinzufügen“.", "Typ, Name, Wert eintragen und speichern."],
    note: "Alternativ automatisch per Cloud-API-Token.",
  },
  inwx: { title: "INWX", steps: ["inwx.de → „Nameserver“ → Domain → „Eintrag hinzufügen“."], note: "Alternativ automatisch per API (Unterbenutzer mit DNS-Rechten empfohlen)." },
  netcup: { title: "netcup", steps: ["Customer Control Panel → „Domains“ → Domain → „DNS“ → Eintrag hinzufügen → „Speichern“."], note: "Alternativ automatisch per CCP-API." },
};

export function guideFor(provider: ProviderKey) {
  const g = GUIDES[provider];
  return { title: g?.title ?? "Allgemein", steps: [...(g?.steps ?? []), ...GENERIC], note: g?.note };
}

// Nameserver beim Registrar auf STACKIT DNS umstellen (Umzug „verwaltet durch Pioneerdesk“).
const NS_GENERIC = [
  "Bei Ihrem Domain-Anbieter (Registrar) anmelden und die Domain öffnen.",
  "Bereich „Nameserver“ bzw. „DNS-Server“ öffnen und „eigene/externe Nameserver“ wählen.",
  "Die bisherigen Nameserver durch genau diese zwei ersetzen: ns1.stackit.cloud und ns2.stackit.zone.",
  "Falls DNSSEC aktiv ist: vor dem Umstellen beim Registrar deaktivieren (DS-Eintrag entfernen), sonst ist die Domain nach dem Wechsel nicht erreichbar.",
  "Speichern. Die Umstellung dauert je nach Domain-Endung wenige Minuten bis 48 Stunden; wir prüfen automatisch und melden, sobald die Delegation greift.",
];

export const NS_GUIDES: Partial<Record<ProviderKey, string[]>> = {
  ionos: ["ionos.de → „Domains & SSL“ → Domain → Zahnrad „Nameserver ändern“ → „Andere Nameserver verwenden“."],
  webde: ["WEB.DE-Domain-Verwaltung → Domain → „Nameserver“ (externe Nameserver sind je nach Tarif nicht verfügbar – dann Domain zu einem Registrar mit Nameserver-Wahl umziehen)."],
  gmx: ["GMX-Domain-Verwaltung → Domain → „Nameserver“ (externe Nameserver sind je nach Tarif nicht verfügbar – dann Domain umziehen)."],
  godaddy: ["godaddy.com → „Meine Produkte“ → Domain → „DNS“ → Reiter „Nameserver“ → „Nameserver ändern“ → „Eigene Nameserver verwenden“."],
  strato: ["STRATO-Kundenlogin → Domain → „Nameserver-Einstellungen“ → externe Nameserver (abhängig vom Paket)."],
  cloudflare: ["Bei Cloudflare als Registrar: Nameserver sind fest – zuerst DNS bei Cloudflare belassen oder Domain zu einem anderen Registrar übertragen."],
  hetzner: ["Hetzner Console/Robot → Domain → „Nameserver“ → eigene Nameserver eintragen."],
  inwx: ["inwx.de → „Domains“ → Domain → „Nameserver“ → „Externe Nameserver“."],
  netcup: ["Customer Control Panel → „Domains“ → Domain → „Nameserver“ → „Eigene Nameserver“."],
};

export function nameserverGuide(provider: ProviderKey) {
  return [...(NS_GUIDES[provider] ?? []), ...NS_GENERIC];
}

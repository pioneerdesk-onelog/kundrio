# Kundrio

**Ein souveränes Agentur-CRM: gebaut für die EU, gehostet in Deutschland, selbst betreibbar.**

[English](README.md) · [Dokumentation (DE)](docs/de/README.md) · [Documentation (EN)](docs/en/README.md)

Kundrio ist ein CRM und eine Marketing-Plattform für Agenturen, nach dem Agentur-/Sub-Account-Prinzip: Eine Agentur verwaltet beliebig viele Sub-Accounts (Kunden oder Projekte). Jeder Sub-Account hat eigene Kontakte, Pipeline, E-Mails, Landingpages, Prozesse und Rechnungen. Kundrio läuft auf europäischer Infrastruktur und braucht keinen US-Clouddienst. Die KI läuft lokal (Ollama) oder bei einem EU-Anbieter, und jedes Datum lässt sich wieder exportieren.

> **Stand:** im Betrieb als gehosteter Dienst unter [kundrio.de](https://kundrio.de) (Demo: [demo.kundrio.de](https://demo.kundrio.de), Benutzer `guest`, Passwort `lassmichrein`). Die Oberfläche ist derzeit nur auf Deutsch.

## Funktionen

| Bereich | Inhalt |
|---|---|
| Agentur & Sub-Accounts | Agentur-Übersicht über alle Sub-Accounts (Vertrieb, Sichtbarkeit, KI-Nutzung, Pflichten), Rollen und Rechte je Objekt mit Reichweite eigene/Team/alle, Vier-Augen-Prinzip wählbar |
| Kontakte & Unternehmen | Tags, CSV-Import/-Export, Zeitleiste, Lifecycle-Phasen, Zuständige, Domain-Zuordnung und Zusammenführen, Lead-Echtheit, eigene Felder und Listen |
| Vertrieb | Pipeline (Kanban, Ziehen und Tastatur), Aufgaben, Kalender, Tickets mit SLA |
| Formulare | Einbettbare Formulare mit Double-Opt-in, Rate-Limit und signiertem Zeitstempel; der Wortlaut der Einwilligung wird als Nachweis gespeichert |
| E-Mail | Einzelmails und Kampagnen mit Freigabe durch einen Menschen (Entwurf → freigegeben → versendet), Abmelde-Header, Bounces und Beschwerden, Sperrliste, **Brevo-kompatible API** (`/api/brevo/v3/…`) |
| Landingpages | Visueller Editor (Puck) mit 14 Blöcken inkl. Buchung, Animationen, KI-Entwurf und Übersetzung, Barrierefreiheits-Prüfung, JSON-LD, sitemap, robots.txt, llms.txt, eigene Domains mit automatischem TLS |
| Prozesse | Flow-Editor mit 27 Knotentypen und 28 Auslösern, Versionen, Testlauf, Läufe-Protokoll, 17 Best-Practice-Vorlagen; transaktionale Outbox, jeder Schritt läuft genau einmal |
| Rechnungen & Zahlungen | Angebote, Auftragsbestätigungen, Rechnungen mit GiroCode und **XRechnung (UBL)**, Online-Annahme, Kundenportal, Bezahllinks (Mollie inkl. Wero, Revolut, Unzer), Abos und **SEPA-Lastschrift** (pain.008), Kontoabgleich mit CAMT.053, Übertragung an Lexware Office |
| Gemeinsamer Posteingang | E-Mail (IMAP/SMTP), WhatsApp Cloud API, SMS (seven.io); Zuweisen, interne Notizen, Gespräch → Ticket |
| Buchungskalender | Öffentliche Buchungsseiten mit freien Zeiten aus den Mitarbeiterkalendern (Google, Microsoft), Bestätigung mit ICS, Jitsi-/Meet-/Teams-Links |
| Analytics | Ohne Cookies und ohne gespeicherte IP; erkennt KI-Crawler und Besucher aus KI-Antworten; Conversions und Umsatz-Zuordnung; Log-Import und Snippet für externe Websites |
| KI | Lokal (Ollama) oder EU-Anbieter; Wissensbasis (RAG mit pgvector), Entwürfe, Kurzfassungen; jeder Aufruf wird protokolliert (Transparenz nach AI Act) |
| MCP & Agent-API | Admin-MCP-Server mit 42 Werkzeugen für externe KI-Assistenten (OAuth 2.1 oder API-Schlüssel), dazu eine öffentliche Agent-API je Sub-Account; alles mit Außenwirkung landet im Freigabe-Eingang |
| Recherche | Anreicherung von Unternehmen und Kontakten als *Vorschlag* (Website, Impressum, Social-Links), Presse-Erwähnungen über eine eigene SearXNG-Instanz, GDELT und RSS |
| Pflichten | Pflichten-Cockpit (BFSG, AI Act, CRA, NIS2, E-Rechnung, Mail-Authentifizierung, DSGVO) mit automatischen Prüfungen |
| Souveränität | Souveränitäts-Cockpit (jede Verbindung nach außen mit Region und Ersatz), vollständiger Datenexport (ZIP), KI-Protokoll, Auskunft (Art. 15) und Löschung (Art. 17) je Kontakt |
| Wechsel | Import aus HubSpot (API) und Brevo (API), CSV in beide Richtungen; kein Lock-in |

Noch nicht enthalten: ZUGFeRD (PDF/A-3), Social-Media-Planung, Sprachassistent.

## Screenshots

_Screenshots folgen mit dem ersten Release._

<!-- docs/images/uebersicht.png, pipeline.png, seiten-editor.png, prozess-editor.png -->

## Schnellstart (lokale Entwicklung)

Voraussetzungen: Docker, Node.js 20, für KI-Funktionen optional [Ollama](https://ollama.com).

```bash
git clone https://github.com/pioneerdesk-onelog/kundrio.git && cd kundrio
cp infra/searxng/settings.example.yml infra/searxng/settings.yml
docker compose up -d                 # Postgres + pgvector, Mailpit, SearXNG – nur an 127.0.0.1
cd app
cp .env.example .env                 # APP_SECRET setzen (openssl rand -hex 32)
npm install
npm run db:migrate && npm run db:seed
npm run user:create -- du@example.com "Dein Name" --agency   # zeigt ein Einmal-Passwort
npm run dev:all                      # App auf http://127.0.0.1:3100 + Hintergrund-Worker
```

Alle E-Mails landen in Mailpit unter http://127.0.0.1:58025, nichts verlässt den Rechner. Für KI-Funktionen die Modelle aus `.env.example` laden (`ollama pull qwen3-embedding:0.6b` und ein Chat-Modell).

Die ausführliche Anleitung, auch für den eigenen Server mit Docker Compose und für STACKIT, steht in [docs/de/installation.md](docs/de/installation.md).

## Architektur

```
Browser ──► Caddy (HTTPS, On-Demand-TLS für Kundendomains)
              └─► Next.js-15-App (App Router, Server Actions)   ◄─┐
                                                                 ├── PostgreSQL 17 + pgvector
              Worker (Jobs, Prozesse, Outbox, Kampagnen)        ◄─┘    (Daten, Vektoren, Job-Warteschlange)
                    ├─► SMTP-Relay / Mailpit
                    ├─► Ollama oder EU-KI-Endpunkt
                    └─► SearXNG, Zahlungs-/Kalender-/Messaging-Anbieter (optional)
```

- **Eine Datenbank.** CRM-Daten, Vektorsuche (HNSW), Job-Warteschlange (`FOR UPDATE SKIP LOCKED`) und Ereignis-Outbox liegen in PostgreSQL. Redis oder ein Message-Broker sind nicht nötig.
- **Mandantentrennung.** Jede fachliche Tabelle hat eine `workspaceId`. Jede Server Action prüft Sitzung, Mitgliedschaft und den Sub-Account des Datensatzes.
- **Mensch entscheidet.** Die KI schlägt vor, ein Mensch übernimmt. Alles mit Außenwirkung (Kampagnen, Webhooks, Schreibzugriffe per MCP) braucht eine ausdrückliche Freigabe.
- **Technik:** Next.js 15, React 19, Prisma 6, Tailwind 4, TypeScript; Tests mit Vitest und Playwright.

Mehr dazu: [docs/de/architektur.md](docs/de/architektur.md).

## Souveränität und DSGVO

- Läuft komplett auf dem eigenen Server oder auf deutscher Cloud-Infrastruktur (STACKIT), ohne nötigen US-Dienst.
- Analytics ohne Cookies und ohne gespeicherte IP-Adresse.
- E-Mail steht standardmäßig auf `capture`: Nichts geht hinaus, bis der Live-Modus eingeschaltet und jede Kampagne freigegeben ist.
- Newsletter nur mit Double-Opt-in; der Wortlaut der Einwilligung wird als Nachweis gespeichert.
- Auskunft und Löschung je Kontakt sind eingebaut, dazu ein vollständiger Datenexport je Sub-Account.
- Das Souveränitäts-Cockpit zeigt jede Verbindung nach außen mit Region und Ersatzmöglichkeit.

## Dokumentation

| | Deutsch | English |
|---|---|---|
| Übersicht | [docs/de](docs/de/README.md) | [docs/en](docs/en/README.md) |
| Installation | [Installation](docs/de/installation.md) | [installation](docs/en/installation.md) |
| Konfiguration | [Konfiguration](docs/de/konfiguration.md) | [configuration](docs/en/configuration.md) |
| Erste Schritte | [Erste Schritte](docs/de/erste-schritte.md) | [getting started](docs/en/getting-started.md) |
| Funktionen | [Funktionen](docs/de/funktionen.md) | [features](docs/en/features.md) |
| Betrieb, Sicherung, Update | [Betrieb](docs/de/betrieb.md) | [operations](docs/en/operations.md) |
| Architektur | [Architektur](docs/de/architektur.md) | [architecture](docs/en/architecture.md) |
| FAQ | [FAQ](docs/de/faq.md) | [faq](docs/en/faq.md) |

## Mitmachen

Beiträge sind willkommen. Bitte zuerst [CONTRIBUTING.de.md](CONTRIBUTING.de.md) lesen. Jede Person, die beiträgt, unterschreibt einmal die [CLA](CLA.md). Sicherheitslücken bitte vertraulich melden, wie in [SECURITY.md](SECURITY.md) beschrieben, nie in öffentlichen Issues.

## Lizenz

Kundrio ist **Fair Source** unter der [Functional Source License 1.1 mit Apache-2.0-Zukunftslizenz (FSL-1.1-ALv2)](LICENSE):

- Nutzen, ändern und selbst betreiben ist für jeden Zweck erlaubt, **außer für ein konkurrierendes kommerzielles Angebot**, also zum Beispiel Kundrio selbst als gehosteten CRM-Dienst zu verkaufen.
- Ausdrücklich erlaubt sind interne Nutzung, nicht-kommerzielle Lehre und Forschung sowie Dienstleistungen für jemanden, der Kundrio unter dieser Lizenz nutzt (etwa Einrichtung oder Umzug).
- **Jede Version wird zwei Jahre nach ihrer Veröffentlichung Apache-2.0.**

Maßgeblich ist der englische Lizenztext in [LICENSE](LICENSE).

© 2026 Pioneerdesk GmbH. „Kundrio“ ist ein Produktname der Pioneerdesk GmbH; die Lizenz gewährt keine Markenrechte.

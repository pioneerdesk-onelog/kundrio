# Mitmachen bei Kundrio

[English](CONTRIBUTING.md)

Danke für dein Interesse. Diese Anleitung erklärt, wie du Änderungen vorschlägst, damit sie schnell übernommen werden können.

## Vor dem Start

- **CLA unterschreiben.** Jede Person, die beiträgt, unterschreibt einmal die [Contributor License Agreement](CLA.md). Der CLA-Bot meldet sich beim ersten Pull Request; antworte mit dem Satz, den er vorgibt. Ohne unterschriebene CLA können wir nichts übernehmen.
- **Erst ein Issue anlegen**, wenn es um mehr als eine kleine Korrektur geht. So klären wir den Weg, bevor du Zeit investierst.
- **Sicherheitslücken** an die Adresse aus [SECURITY.md](SECURITY.md) melden, nie in öffentlichen Issues.

## Entwicklungsumgebung

Siehe Schnellstart im [README](README.de.md) oder die ausführliche Anleitung in [docs/de/installation.md](docs/de/installation.md). Kurz:

```bash
docker compose up -d
cd app && cp .env.example .env && npm install
npm run db:migrate && npm run db:seed
npm run dev:all
```

## Prüfungen vor jedem Pull Request

```bash
cd app
npm run typecheck
npm run lint
npm test            # Unit-Tests; DB-Tests laufen, wenn DATABASE_URL gesetzt ist und der E2E-Seed existiert
npm run build
```

Die End-to-End-Tests (`npm run e2e`) legen ihren eigenen Sub-Account `e2e` an und führen alle Playwright-Suiten aus. Sie brauchen die lokalen Docker-Dienste. Die CI prüft bei jedem Pull Request Typen, Lint und Unit-Tests.

## Regeln für den Code

Diese Regeln halten Mandanten getrennt und Daten konsistent. Pull Requests, die dagegen verstoßen, werden nicht übernommen.

- **Mandantentrennung.** Jede fachliche Tabelle hat eine `workspaceId`. Den Sub-Account über `getWorkspace(slug)` bzw. `pageAccess(slug)` laden und jede ID aus einer Server Action gegen diesen Sub-Account prüfen. Rechte über `requireAccess`, `can` und `scopeWhere` prüfen.
- **Öffentliche Routen** gibt es nur in `(public)/**`, `(landing)/**`, `api/a/**` und `api/agent/**`. Alles andere braucht eine Anmeldung.
- **Schema nur per Migration ändern:** `./scripts/new-migration.sh <name>`. Nie `prisma db push` oder `prisma migrate dev`, denn beide löschen Raw-Indizes wie den HNSW-Vektorindex.
- **Ereignisse.** Fachliche Änderungen schreiben per `emitEvent(…, tx)` ein Ereignis in derselben Transaktion (Outbox).
- **KI-Aufrufe** nur über `src/lib/ai.ts`, weil dort Zweck und Modell protokolliert werden.
- **Lange Arbeit** läuft als Job: `enqueue()` aus `src/lib/jobs.ts`, Handler in `src/jobs/<bereich>.ts`.
- **Nichts geht ohne Freigabe nach außen.** E-Mail steht standardmäßig auf capture, Außenwirkung braucht eine Freigabe.
- **Jede Fehlerbehebung bekommt einen Test**, der den Fehler vorher zeigt.
- **Oberflächentexte sind deutsch**, schlicht und kurz. Eine englische Oberfläche ist willkommen, aber als eigenes Vorhaben; bitte vorher ein Issue anlegen.

## Commits und Pull Requests

- Ein Thema pro Pull Request. Beschreibe, was sich ändert, warum, und wie du getestet hast.
- Commits klein halten. Commit-Nachrichten auf Deutsch oder Englisch.
- Neue Abhängigkeiten brauchen einen Grund. Bevorzugt EU-freundliche Pakete mit freier Lizenz und ohne „nach Hause telefonieren“.
- Doku gehört zum Pull Request: Bei geändertem Verhalten `docs/de` **und** `docs/en` anpassen.

## Lizenz

Mit deinem Beitrag stimmst du zu, dass er unter der Projektlizenz ([FSL-1.1-ALv2](LICENSE)) steht und dass die Pioneerdesk GmbH ihn wie in der [CLA](CLA.md) beschrieben neu lizenzieren darf.

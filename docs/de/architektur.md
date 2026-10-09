# Architektur

[English](../en/architecture.md)

## Bausteine

| Teil | Technik | Aufgabe |
|---|---|---|
| App | Next.js 15 (App Router, Server Actions), React 19 | Oberfläche, öffentliche Seiten, APIs, MCP |
| Worker | Node.js, gleiches Image wie die App | Jobs, Prozess-Engine, Ereignis-Verteiler, Kampagnen, KI-Aufgaben, Analytics-Import, Pflichten-Prüfung |
| Datenbank | PostgreSQL 17 mit pgvector und pg_trgm | Fachdaten, Vektoren (HNSW), Job-Warteschlange, Outbox, Rate-Limits |
| Edge | Caddy | HTTPS, HSTS, On-Demand-TLS für Kundendomains |
| KI | Ollama oder OpenAI-kompatibler EU-Dienst | Embeddings (1024 Dimensionen), Chat |
| Suche | SearXNG (selbst betrieben) | Recherche ohne Tracking |
| Mail | SMTP-Relay; lokal Mailpit | Versand, Bounces über Webhook |

## Ordner

```
app/
  src/app/(admin)/       interner Bereich (Anmeldung Pflicht)
  src/app/(public)/      öffentliche Seiten: Login, Formulare, Buchung, Portal, Zahlung
  src/app/(landing)/     Landingpages und Kundendomains
  src/app/api/           APIs: Analytics, Agent-API, Brevo-kompatibel, MCP, Webhooks, Health
  src/lib/               Fachlogik (Rechte, Prozesse, Mail, Rechnungen, KI, Datenschutz …)
  src/jobs/              Job-Handler des Workers
  prisma/                Schema, Migrationen, Seed
  scripts/               Worker, Benutzer anlegen, Migrationen, Seeds
  e2e/                   Playwright-Tests und Konsistenzprüfungen
deploy/compose/          Produktion mit Docker Compose und Caddy
deploy/k8s/              Kubernetes (STACKIT SKE)
deploy/backup/           Backup-Image (pg_dump + age + rclone)
```

## Grundentscheidungen

- **Eine Datenbank für alles.** pgvector statt eigener Vektor-Datenbank, Job-Warteschlange mit `FOR UPDATE SKIP LOCKED` statt Redis. Weniger Teile, transaktional konsistent, Mandantenfilter in derselben Abfrage.
- **Mandantentrennung in jeder Abfrage.** Jede fachliche Tabelle hat `workspaceId`. Seiten und Server Actions laden den Sub-Account über `getWorkspace`/`pageAccess` und prüfen jede ID dagegen. Rechte prüfen `requireAccess`, `can` und `scopeWhere` zentral.
- **Transaktionale Outbox.** Fachliche Änderungen schreiben in derselben Transaktion ein Ereignis (`CrmEvent`). Der Worker verteilt Ereignisse an Prozesse. Schritte laufen genau einmal, Außenwirkung höchstens einmal.
- **Freigabe-Prinzip.** E-Mail standardmäßig `capture`; Kampagnen, Prozesse mit Außenwirkung und Schreibzugriffe über MCP brauchen eine Freigabe durch einen Menschen.
- **Eigene Anmeldung.** scrypt-Passwörter, Sitzungstoken nur als Hash in der Datenbank, Cookies `httpOnly`/`SameSite=Lax`, keine Selbstregistrierung, kein externer Identitätsdienst. OAuth 2.1 nur als Server für MCP-Clients.
- **KI über eine Stelle.** Alle KI-Aufrufe gehen über `src/lib/ai.ts`. Das Protokoll hält Zweck und Modell fest (AI Act). KI liefert Vorschläge, Menschen übernehmen.
- **Analytics ohne Cookies.** Tages-Hash mit täglich neuem Salz, IP nur flüchtig. KI-Crawler werden serverseitig erfasst, weil sie kein JavaScript ausführen.
- **Kein Lock-in.** Jeder Import hat einen gleichwertigen Export. Die Schnittstellen sind zu bekannten Anbietern kompatibel (Brevo v3).
- **Landingpages mit Puck** (MIT) und Motion. Seiten sind JSON in Postgres und werden mit eigenen React-Blöcken gerendert.

## Datenfluss am Beispiel Formular

1. Besucher sendet `/f/<id>` ab → Rate-Limit, Prüfung, Kontakt anlegen oder aktualisieren, Ereignis `form.submitted` (eine Transaktion).
2. Bei Newsletter-Einwilligung geht eine Bestätigungsmail hinaus (höchstens eine pro Adresse und Stunde; im Modus `capture` abgefangen).
3. Klick auf den Bestätigungslink → `consentEmailAt` und Wortlaut gespeichert, Ereignis.
4. Worker verteilt die Ereignisse an veröffentlichte Prozesse (z. B. „Lead-Eingang“: Aufgabe für Vertrieb, Lifecycle-Phase setzen).

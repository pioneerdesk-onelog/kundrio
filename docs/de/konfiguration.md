# Konfiguration

[English](../en/configuration.md)

Kundrio wird über Umgebungsvariablen konfiguriert. Lokal stehen sie in `app/.env` (Vorlage: `app/.env.example`), in Produktion in `deploy/compose/.env.prod` bzw. in Kubernetes-Secrets. **Geheimnisse gehören nie ins Repository**, auch nicht in die Datenbank. Schlüssel für Anbieter je Sub-Account (Zahlungen, WhatsApp, IMAP usw.) werden in der Oberfläche eingetragen und verschlüsselt gespeichert.

Spalte **Geheim**: ✅ = vertraulich behandeln (Secrets Manager, Rechte 600), – = unkritisch.

## Grundlagen

| Variable | Zweck | Geheim |
|---|---|---|
| `DATABASE_URL` | PostgreSQL-Verbindung mit pgvector. Produktion: `?sslmode=require` | ✅ (enthält Passwort) |
| `APP_SECRET` | Signiert Sitzungen, Tokens, DOI- und Abmeldelinks und verschlüsselt gespeicherte Zugangsdaten. Mindestens 32 Zeichen (`openssl rand -hex 32`). Ein Wechsel macht alle Sitzungen und alten Links ungültig, und gespeicherte Anbieter-Zugangsdaten (Zahlungen, Importe) lassen sich nicht mehr entschlüsseln und müssen neu eingetragen werden | ✅ |
| `APP_URL` | Öffentliche Adresse der App, in Produktion `https://…` | – |
| `APP_HOSTS` | Weitere eigene Hostnamen (kommagetrennt), die nicht als Kundendomain gelten | – |
| `TRUST_PROXY` | Anzahl vertrauenswürdiger Reverse-Proxys vor der App (Caddy/Ingress = `1`). Davon hängen Rate-Limits und Besucher-Hash ab | – |
| `RATE_LIMIT_STORE` | `memory` (ein Prozess) oder `db` (mehrere Instanzen). Leer: Entwicklung `memory`, Produktion `db` | – |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`. Logs sind JSON-Zeilen ohne personenbezogene Daten | – |
| `NODE_ENV` | `production` schaltet die Startprüfung der Variablen ein | – |
| `SKIP_ENV_CHECK` | `1` überspringt die Startprüfung, nur für den Image-Build | – |
| `FILE_STORAGE_DIR` | Ordner für hochgeladene Dateien (Standard `app/.data/files`), wenn kein S3 gesetzt ist | – |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` | S3-kompatibler Dateispeicher (z. B. STACKIT Object Storage). Gesetzt → Dateien liegen in S3 | – |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Zugang zum Bucket (auch für Backups) | ✅ |

## KI

| Variable | Zweck | Geheim |
|---|---|---|
| `AI_PROVIDER` | `ollama` (Standard, lokal) oder `openai` für einen OpenAI-kompatiblen Dienst, z. B. STACKIT AI Model Serving | – |
| `AI_BASE_URL` | Basis-URL des OpenAI-kompatiblen Dienstes (nur bei `openai`, muss `https://` sein) | – |
| `AI_API_KEY` | Schlüssel für den OpenAI-kompatiblen Dienst | ✅ |
| `OLLAMA_BASE_URL` | Adresse des Ollama-Servers, lokal `http://127.0.0.1:11434` | – |
| `OLLAMA_EMBED_MODEL` | Embedding-Modell. Muss `EMBED_DIM` Dimensionen liefern; Wechsel = Wissensbasis neu indizieren | – |
| `EMBED_DIM` | Dimension der Vektoren, fest `1024` (Datenbankschema `vector(1024)`) | – |
| `OLLAMA_CHAT_MODEL` | Chat-Modell für Entwürfe, Kurzfassungen, Übersetzungen | – |
| `OLLAMA_CHAT_TIMEOUT_MS`, `OLLAMA_EMBED_TIMEOUT_MS` | Zeitlimits der KI-Aufrufe | – |

## E-Mail

| Variable | Zweck | Geheim |
|---|---|---|
| `MAIL_MODE` | `capture` (Standard): alles geht an Mailpit bzw. ins Protokoll. `live`: echter Versand über SMTP | – |
| `MAIL_LIVE_ALLOWLIST` | Nur bei `live`: kommagetrennte Adressen oder `@domain`. Gesetzt → nur diese Empfänger gehen echt hinaus, der Rest wird abgefangen. Leer → alles geht hinaus | – |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP-Relay. Bei Port 587 wird STARTTLS erzwungen | – |
| `SMTP_USER` | SMTP-Benutzer | – |
| `SMTP_PASS` | SMTP-Passwort | ✅ |
| `SYSTEM_MAIL_FROM` | Absender für Mails ohne Sub-Account-Bezug (Einladungen), z. B. `Kundrio <crm@example.com>` | – |
| `MAIL_EVENTS_SECRET` | Schützt den Ereignis-Eingang des Relays (`/api/mail/events/<anbieter>?secret=…`) für Bounces und Beschwerden | ✅ |
| `MAIL_SPF_INCLUDE`, `MAIL_DKIM_SELECTOR`, `MAIL_DKIM_TARGET`, `MAIL_DMARC_RUA` | Sollwerte für die Prüfung der Absenderdomains im Pflichten-Cockpit | – |

## Webhooks, Recherche, Marke

| Variable | Zweck | Geheim |
|---|---|---|
| `WEBHOOK_ALLOW_PRIVATE` | Nur Entwicklung: Webhooks an private Adressen erlauben | – |
| `SEARXNG_URL` | Eigene SearXNG-Instanz für Anreicherung und Presse-Erwähnungen | – |
| `SEARXNG_ENGINES` | Bevorzugte Suchdienste, z. B. `mojeek,startpage,duckduckgo` | – |
| `RESEARCH_GDELT` | `off` schaltet die GDELT-Abfrage ab | – |
| `ENRICH_ALLOW_PRIVATE`, `BRAND_FETCH_ALLOW_PRIVATE` | Nur Entwicklung/Tests: Abruf privater Adressen erlauben | – |
| `YOUTUBE_API_KEY` | Öffentliche YouTube-Kanalstatistiken (optional) | ✅ |

## Kalender und Video

| Variable | Zweck | Geheim |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth-Client für Google Kalender/Meet. Weiterleitung: `<APP_URL>/api/calendar/oauth/google/callback` | – |
| `GOOGLE_CLIENT_SECRET` | dazu | ✅ |
| `MS_CLIENT_ID`, `MS_TENANT` | Microsoft-Entra-App für Kalender/Teams. Weiterleitung: `<APP_URL>/api/calendar/oauth/microsoft/callback` | – |
| `MS_CLIENT_SECRET` | dazu | ✅ |
| `JITSI_BASE_URL` | Jitsi-Instanz für Termine ohne Kalender-Verbindung. Empfehlung: eigene EU-Instanz statt `meet.jit.si` | – |
| `OPENTALK_BASE_URL` | Optional: OpenTalk-Instanz | – |

## Social-Kanäle (nur lesend)

Weiterleitungs-URL je Plattform: `<APP_URL>/api/channels/oauth/<plattform>/callback`.

| Variable | Zweck | Geheim |
|---|---|---|
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_API_VERSION` | LinkedIn Community Management API | – |
| `LINKEDIN_CLIENT_SECRET` | dazu | ✅ |
| `META_APP_ID`, `META_GRAPH_VERSION` | Facebook-Seiten und Instagram Business | – |
| `META_APP_SECRET` | dazu | ✅ |
| `X_BEARER_TOKEN` | X (kostenpflichtig) | ✅ |
| `X_MAX_POSTS_PER_SYNC` | Begrenzung der abgerufenen Beiträge | – |
| `TIKTOK_CLIENT_KEY` | TikTok Login Kit / Display API | – |
| `TIKTOK_CLIENT_SECRET` | dazu | ✅ |

## Kundendomains und DNS

| Variable | Zweck | Geheim |
|---|---|---|
| `LANDING_CNAME_TARGET` | Hostname, auf den Kunden ihre Domain per CNAME zeigen lassen (zeigt auf Caddy) | – |
| `LANDING_IPV4`, `LANDING_IPV6` | Öffentliche Adressen für Apex-Domains ohne CNAME | – |
| `CADDY_ASK_SECRET` | Schützt `/api/domains/ask`, über den Caddy fragt, ob es ein Zertifikat ausstellen darf | ✅ |
| `DNS_CHECK_RESOLVERS` | Eigene Resolver für die Domain-Prüfung (`name=ip,…`) | – |
| `DOMAIN_CONNECT_PROVIDER_ID`, `DOMAIN_CONNECT_SERVICE_ID` | Domain Connect, erst nach Freischaltung beim DNS-Anbieter | – |
| `STACKIT_DNS_PROJECT_ID` | STACKIT-Projekt, in dem Kundenzonen angelegt werden | – |
| `STACKIT_SERVICE_ACCOUNT_KEY_PATH` / `STACKIT_SERVICE_ACCOUNT_KEY` | Service-Account-Schlüssel (Datei bevorzugt) | ✅ |
| `STACKIT_PRIVATE_KEY_PATH` | Nur bei eigenem Schlüsselpaar | ✅ |
| `STACKIT_DNS_TOKEN` | Nur Entwicklung: festes Token | ✅ |
| `STACKIT_DNS_CONTACT_EMAIL` | Kontaktadresse im SOA der Zonen | – |

## WhatsApp, SMS, Zahlungen, Buchhaltung

| Variable | Zweck | Geheim |
|---|---|---|
| `MESSAGING_MODE` | `capture` (Standard) oder `live` für WhatsApp/SMS | – |
| `MESSAGING_LIVE_ALLOWLIST` | Im Live-Modus nur an diese Nummern (E.164) | – |
| `WHATSAPP_GRAPH_BASE`, `SEVEN_API_BASE` | Basis-URLs, nur für Tests/Proxys ändern | – |
| `PAYMENTS_MODE` | `test` (Standard, Live-Schlüssel werden abgelehnt) oder `live` | – |
| `PAYMENTS_PUBLIC_URL` | Öffentliche Basis-URL für Webhooks und Rückleitung (leer = `APP_URL`) | – |
| `MOLLIE_API_BASE`, `REVOLUT_MERCHANT_BASE`, `REVOLUT_MERCHANT_API_VERSION`, `UNZER_API_BASE`, `REVOLUT_BUSINESS_BASE` | Basis-URLs der Anbieter, nur für Tests/Proxys ändern | – |
| `LEXWARE_API_KEY` | Lexware Office Public API | ✅ |
| `LEXWARE_BASE_URL` | Nur für Tests gegen einen Mock-Server | – |

Die Zugangsdaten der Zahlungs- und Messaging-Anbieter trägt jeder Sub-Account selbst in der Oberfläche ein. Sie werden mit einem Schlüssel aus `APP_SECRET` verschlüsselt gespeichert.

## Tests

| Variable | Zweck | Geheim |
|---|---|---|
| `E2E_INTERNAL_EMAIL`, `E2E_CUSTOMER_EMAIL` | Pflicht für `npm run e2e:seed`: Testadressen für den Sub-Account `e2e` | – |
| `E2E_SENDER_EMAIL` | Absender im Live-Mail-Test (nur mit `MAIL_MODE=live`) | – |
| `E2E_PASSWORD` | Festes Passwort der Testbenutzer (sonst zufällig) | ✅ |

## Produktion

Zusätzlich zur App liest die Compose-Datei (`deploy/compose/docker-compose.prod.yml`) diese Variablen aus `.env.prod`:

| Variable | Zweck | Geheim |
|---|---|---|
| `CRM_DOMAIN` | Domain der App (daraus wird `APP_URL=https://<CRM_DOMAIN>`) | – |
| `ACME_EMAIL` | Kontakt für Let's Encrypt | – |
| `LOCAL_DB_PASSWORD` | Nur mit Profil `local-db` | ✅ |
| `APP_REPLICAS` | Anzahl der App-Container (Standard 2) | – |
| `CRM_IMAGE`, `BACKUP_IMAGE` | Image-Namen bzw. Tags | – |
| `BACKUP_AGE_RECIPIENT` | Öffentlicher age-Schlüssel (`age1…`) für die Backup-Verschlüsselung | – |
| `BACKUP_HOUR_UTC` | Uhrzeit des täglichen Backups (Standard 2) | – |
| `KEEP_DAILY`, `KEEP_WEEKLY`, `KEEP_MONTHLY` | Aufbewahrung der Backups (14 / 8 / 12) | – |

Beispiel für eine minimale `.env.prod`:

```dotenv
CRM_DOMAIN=crm.example.com
ACME_EMAIL=admin@example.com
DATABASE_URL=postgresql://crm:<passwort>@<host>:5432/crm?sslmode=require
APP_SECRET=<openssl rand -hex 32>
MAIL_EVENTS_SECRET=<openssl rand -hex 32>
MAIL_MODE=capture
SMTP_HOST=<relay>
SMTP_PORT=587
SMTP_USER=<benutzer>
SMTP_PASS=<passwort>
AI_PROVIDER=openai
AI_BASE_URL=https://<openai-kompatibler-endpunkt>/v1
AI_API_KEY=<schlüssel>
BACKUP_AGE_RECIPIENT=age1...
S3_ENDPOINT=https://object.storage.eu01.onstackit.cloud
S3_BUCKET=kundrio-backups
S3_ACCESS_KEY=<zugang>
S3_SECRET_KEY=<geheimnis>
CADDY_ASK_SECRET=<openssl rand -hex 24>
LANDING_CNAME_TARGET=sites.example.com
```

Hinweis: Die Compose-Datei reicht nur die dort aufgeführten Variablen an App und Worker weiter. Wer weitere Variablen aus dieser Liste braucht (z. B. Kalender, Zahlungen), ergänzt sie im Block `x-app-env`.

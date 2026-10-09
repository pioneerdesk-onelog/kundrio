# Installation

[English](../en/installation.md)

Es gibt drei Wege:

1. **Lokale Entwicklung** auf dem eigenen Rechner. Alles bleibt auf `127.0.0.1`, E-Mails landen in Mailpit.
2. **Eigener Server mit Docker Compose**: eine Linux-VM mit Caddy (HTTPS), App, Worker und Backup.
3. **STACKIT**: dieselbe Compose-Variante auf einer STACKIT-VM mit PostgreSQL Flex und Object Storage. Für größere Installationen gibt es Kubernetes-Manifeste für STACKIT SKE.

## 1. Lokale Entwicklung

### Voraussetzungen

- Docker mit Compose-Plugin
- Node.js 20 (siehe `app/Dockerfile`, `NODE_VERSION`)
- optional [Ollama](https://ollama.com) für KI-Funktionen

### Schritte

```bash
git clone https://github.com/pioneerdesk-onelog/kundrio.git
cd kundrio
cp infra/searxng/settings.example.yml infra/searxng/settings.yml   # in settings.yml secret_key setzen
docker compose up -d
```

`docker compose` startet drei Dienste, alle nur an `127.0.0.1` gebunden:

| Dienst | Adresse | Zweck |
|---|---|---|
| PostgreSQL 17 + pgvector | `127.0.0.1:55433` | Datenbank, Vektorsuche, Job-Warteschlange |
| Mailpit | SMTP `127.0.0.1:51025`, Web `http://127.0.0.1:58025` | fängt alle E-Mails ab |
| SearXNG | `http://127.0.0.1:58080` | eigene Metasuchmaschine für Recherche und Presse-Erwähnungen |

Dann die App:

```bash
cd app
cp .env.example .env
# In .env mindestens APP_SECRET setzen:  openssl rand -hex 32
npm install
npm run db:migrate        # Migrationen (legt auch die Extensions vector und pg_trgm an)
npm run db:seed           # Demo-Agentur mit vier Demo-Sub-Accounts
npm run user:create -- du@example.com "Dein Name" --agency
npm run dev:all           # App http://127.0.0.1:3100 + Worker
```

`user:create` gibt ein **Einmal-Passwort** aus. Damit anmelden und das Passwort unter *Konto* ändern. Der erste Agentur-Benutzer wird Inhaber.

### KI lokal

```bash
ollama pull qwen3-embedding:0.6b     # Embeddings (1024 Dimensionen, passend zum Schema)
ollama pull qwen3.6:35b-a3b          # Chat-Modell laut .env.example – oder ein kleineres Modell
```

Das Chat-Modell kannst du in `OLLAMA_CHAT_MODEL` frei wählen. Das Embedding-Modell muss **1024 Dimensionen** liefern (`EMBED_DIM`). Wer das Embedding-Modell wechselt, muss die Wissensbasis neu indizieren. Ohne Ollama läuft Kundrio weiter, nur die KI-Funktionen melden einen Fehler.

### Prüfen

```bash
npm run typecheck && npm run lint && npm test
npm run e2e        # End-to-End-Tests (Playwright); legen einen eigenen Sub-Account „e2e“ an
```

Für `npm run e2e` braucht `.env` zusätzlich `E2E_INTERNAL_EMAIL` und `E2E_CUSTOMER_EMAIL` (beliebige Testadressen, z. B. `@example.com`). Mit `MAIL_MODE=capture` geht dabei nichts hinaus.

## 2. Eigener Server mit Docker Compose

Dateien: `deploy/compose/docker-compose.prod.yml`, `deploy/compose/Caddyfile`, Backup-Image in `deploy/backup/`.

Die Compose-Datei startet:

- **caddy**: HTTPS mit Let's Encrypt, HSTS, Kompression, On-Demand-TLS für Kundendomains
- **migrate**: führt vor jedem Start `prisma migrate deploy` aus
- **app**: Next.js, standardmäßig 2 Replikate, Dateisystem nur lesbar
- **worker**: Jobs, Prozesse, Kampagnen, Ereignis-Verteiler
- **backup**: tägliches, mit [age](https://age-encryption.org) verschlüsseltes `pg_dump` in einen S3-Bucket
- **db** (optional, Profil `local-db`): lokale PostgreSQL mit pgvector, wenn keine Managed-Datenbank genutzt wird

### Schritte

1. Linux-VM (Debian/Ubuntu) mit Docker und Compose-Plugin. Firewall: 22 (eingeschränkt), 80, 443.
2. DNS: A/AAAA-Eintrag der gewünschten Domain auf die VM.
3. Repository auf die VM holen und die Umgebungsdatei anlegen:
   ```bash
   cd deploy/compose
   touch .env.prod && chmod 600 .env.prod
   ```
   Inhalt siehe [Konfiguration](konfiguration.md#produktion). Geheimnisse mit `openssl rand -hex 32` erzeugen.
4. Backup-Schlüssel auf einem **anderen** Rechner erzeugen: `age-keygen -o kundrio-backup.key`. Nur den öffentlichen Schlüssel (`age1…`) als `BACKUP_AGE_RECIPIENT` eintragen. Den privaten Schlüssel offline aufbewahren.
5. Starten:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   # mit lokaler Datenbank:
   docker compose -f docker-compose.prod.yml --env-file .env.prod --profile local-db up -d --build
   ```
6. Ersten Benutzer anlegen:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm app \
     npx tsx --conditions=react-server scripts/user.ts du@example.com "Dein Name" --agency
   ```
7. Prüfen: `curl https://<domain>/api/health?deep=1` muss `200` liefern und `worker: ok` melden. Danach anmelden und eine Testmail schicken (im Modus `capture` landet sie nur im Protokoll).

In Produktion verweigern App und Worker den Start, wenn `APP_SECRET` kürzer als 32 Zeichen ist, `APP_URL` kein `https` nutzt oder `DATABASE_URL`, `MAIL_EVENTS_SECRET` bzw. `TRUST_PROXY` fehlen.

## 3. STACKIT

Empfohlener Start: **eine STACKIT-VM mit Docker Compose** (wie Abschnitt 2), dazu Managed-Dienste:

| Baustein | STACKIT-Dienst | Hinweis |
|---|---|---|
| Server | Compute Engine (VM) | z. B. 2–4 vCPU, 8 GB RAM |
| Datenbank | PostgreSQL Flex, Version 17 | Extensions als DB-Owner anlegen: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;` · ACL nur für die VM · `sslmode=require` |
| Backups und Dateien | Object Storage (S3-kompatibel) | Endpunkt `https://object.storage.eu01.onstackit.cloud`; eigener Bucket für Backups |
| KI | AI Model Serving oder eigene GPU-VM mit Ollama | Embedding-Modell auf **1024 Dimensionen** einstellen |
| Geheimnisse | Secrets Manager | Werte zur Laufzeit in `.env.prod` bzw. die Umgebung der Container übernehmen, nie ins Repository |
| DNS | STACKIT DNS (optional) | auch für Kundendomains nutzbar, siehe [Konfiguration](konfiguration.md) |

Kubernetes (STACKIT SKE) mit ingress-nginx, cert-manager, NetworkPolicies und Pod Security „restricted“ ist in [`deploy/k8s/README.md`](../../deploy/k8s/README.md) beschrieben.

## Checkliste vor dem Go-live

- HTTPS aktiv, `TRUST_PROXY=1` hinter Caddy bzw. Ingress
- `MAIL_MODE=live` erst, wenn SPF, DKIM und DMARC für jede Absenderdomain stimmen und eine Testmail an interne Adressen angekommen ist
- Auftragsverarbeitungsverträge (Art. 28 DSGVO) mit Hoster und Mail-Relay, Datenschutzerklärung und Impressum je Sub-Account
- Wiederherstellung einmal geprobt (siehe [Betrieb](betrieb.md)), Backup-Alarm aktiv
- Keine Test-Benutzer oder Test-Schlüssel mehr in der Datenbank

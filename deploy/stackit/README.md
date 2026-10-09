# Kundrio auf STACKIT (VM)

Eine VM betreibt die Website (`kundrio.de`), die Plattform (`app.kundrio.de`), die öffentliche Demo (`demo.kundrio.de`) und eigene Kundendomains (On-Demand-TLS). Daten liegen in STACKIT-Diensten in EU01.

| Baustein | STACKIT-Dienst | Hinweis |
|---|---|---|
| VM `kundrio-vm` | Compute `g2i.4` (4 vCPU, 16 GB), Ubuntu 24.04 | Firewall: 80/443 offen, 22 nur von der Admin-IP |
| Datenbank | PostgreSQL Flex 17, `4.8` Single | ACL nur VM-IP, eigene Backups täglich 01:00 UTC, 32 Tage |
| Dateien | Object Storage, Bucket `kundrio-files` | `S3_*` der App |
| Backups (Exit) | Object Storage, Bucket `kundrio-backups` | `pg_dump`, age-verschlüsselt, täglich 02:00 UTC |
| Geheimnisse | Secrets Manager `kundrio` (Pfade `app`, `backup`, `demo`) | VM liest mit Nur-Lese-Benutzer |
| KI | AI Model Serving (OpenAI-kompatibel) | Chat `Qwen/Qwen3.6-27B`, Embeddings `Qwen/Qwen3-VL-Embedding-8B` (1024 Dim.) |
| Demo-Datenbank | Container `demo-db` auf der VM | jede Nacht 03:30 UTC neu aufgebaut |

## Geheimnisse

Alle Geheimnisse liegen **nur** im Secrets Manager. `fetch-secrets.sh` meldet sich mit dem Nur-Lese-Benutzer aus `/etc/kundrio/sm.env` (root, 600) an und schreibt je Pfad eine Datei nach `/run/kundrio/` (tmpfs, 600). Auf der Platte und im Repo steht kein Wert.

| Pfad | Schlüssel |
|---|---|
| `app` | `DATABASE_URL`, `APP_SECRET`, `MAIL_EVENTS_SECRET`, `CADDY_ASK_SECRET`, `AI_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| `backup` | `DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| `demo` | `APP_SECRET`, `MAIL_EVENTS_SECRET`, `AI_API_KEY`, `DEMO_DB_PASSWORD`, `DEMO_GUEST_PASSWORD` |

Neue Schlüssel (z. B. `SMTP_PASS`, `LEXWARE_API_KEY`, `MOLLIE_…`) im Portal unter *Secrets Manager → kundrio → Pfad app* ergänzen, dann auf der VM `sudo systemctl restart kundrio`. Nicht geheime Einstellungen stehen in `app.config.env` bzw. `demo.config.env`.

Der **private** Backup-Schlüssel (age) liegt nicht bei STACKIT, sondern offline im Tresor. Ohne ihn lassen sich die Backups im Bucket nicht lesen.

## Erstinstallation

1. Ressourcen anlegen (VM, Netz, Sicherheitsgruppe, öffentliche IP, PostgreSQL Flex mit ACL = VM-IP, Object Storage mit zwei Buckets, Secrets Manager mit ACL = VM-IP, AI-Model-Serving-Token).
2. Auf der Datenbank als Admin: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
3. Secrets eintragen (Tabelle oben), Nur-Lese-Benutzer im Secrets Manager anlegen, Zugang nach `/etc/kundrio/sm.env`.
4. Code nach `/opt/kundrio/src` (Repo-Inhalt ohne `.env`), dann:
   ```
   sudo cp deploy/stackit/docker-daemon.json /etc/docker/daemon.json && sudo systemctl restart docker
   sudo cp deploy/stackit/kundrio.service /etc/systemd/system/ && sudo systemctl enable --now kundrio
   sudo cp deploy/stackit/kundrio-demo-reset.cron /etc/cron.d/kundrio-demo-reset
   sudo deploy/stackit/demo-reset.sh          # Demo das erste Mal aufbauen
   ```
5. `ACME_EMAIL=…` nach `/etc/kundrio/host.env` (Kontakt für Let's Encrypt).
6. Ersten Admin der Produktion anlegen:
   `sudo docker compose -f docker-compose.yml --env-file /run/kundrio/compose.env run --rm app npx tsx --conditions=react-server scripts/user.ts <mail> "<Name>" --agency`
7. DNS (siehe unten), danach holt Caddy die Zertifikate selbst.

## DNS (bei IONOS)

| Name | Typ | Wert |
|---|---|---|
| `kundrio.de` | A | IP der VM |
| `www.kundrio.de` | CNAME | `kundrio.de` |
| `app.kundrio.de` | A | IP der VM |
| `demo.kundrio.de` | A | IP der VM |
| `sites.kundrio.de` | A | IP der VM (CNAME-Ziel für Kundendomains) |
| `kundrio.de` | CAA | `0 issue "letsencrypt.org"` und `0 issue "sectigo.com"` (Caddy weicht auf ZeroSSL aus) |

## Update

```
# lokal: Code übertragen (nur versionierte Dateien, nie .env)
git ls-files -co --exclude-standard -- app deploy site | tar -czf - -T - | ssh kundrio 'tar -xzf - -C /opt/kundrio/src'
ssh kundrio 'sudo systemctl restart kundrio'     # Secrets neu holen, bauen, Migration, Start
curl -s https://app.kundrio.de/api/health?deep=1
```

## Demo

`demo.kundrio.de`, Benutzer `guest`, Passwort `lassmichrein` (öffentlich auf der Website). Eigene Datenbank, eigene Secrets, eigener KI-Token, kein Mailversand, keine Kundendomains. Das Gastkonto kann weder Passwort noch Rolle ändern (`src/lib/demo.ts`). Neuaufbau: `sudo deploy/stackit/demo-reset.sh`.

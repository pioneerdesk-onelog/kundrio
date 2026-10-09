# Betrieb – Runbook Kundrio

Zwei Wege: **VM mit Docker Compose** (`deploy/compose/`) oder **STACKIT SKE** (`deploy/k8s/`, eigene README). Dieses Runbook gilt für beide.

**Produktiv seit 2026-10-09:** STACKIT-VM nach `deploy/stackit/README.md` (Website, `app.kundrio.de`, Demo `demo.kundrio.de`; Geheimnisse nur im STACKIT Secrets Manager, KI über STACKIT AI Model Serving).

## Bausteine
| Teil | Aufgabe | Prüfung |
|---|---|---|
| App (≥ 2 Replikate) | Web-Oberfläche, APIs, MCP | `GET /api/health` |
| Worker (1–n) | Jobs, Prozess-Engine, Ereignis-Verteiler, Herzschlag alle 30 s | `GET /api/health?deep=1` → `worker: ok` |
| Migration (einmalig je Update) | `prisma migrate deploy` | Exit-Code 0 |
| Backup (täglich 02:00 UTC) | pg_dump → age-verschlüsselt → S3 | Objekte in `daily/` |
| Caddy bzw. Ingress | HTTPS, HSTS, Kompression, Body-Limit 25 MB | Zertifikat gültig |

Wichtige Variablen: siehe `deploy/compose/.env.prod.example`. In Produktion verweigern App und Worker den Start, wenn `APP_SECRET` (< 32 Zeichen), `APP_URL` (kein https), `MAIL_EVENTS_SECRET`, `DATABASE_URL` oder `TRUST_PROXY` fehlen bzw. unsicher sind.

## Erstinstallation (VM)
1. VM (STACKIT, Debian/Ubuntu), Docker + Compose-Plugin, Firewall: nur 22 (eingeschränkt), 80, 443.
2. DNS: A/AAAA für `CRM_DOMAIN` auf die VM.
3. `deploy/compose/.env.prod` aus der Vorlage, Rechte `600`, Geheimnisse mit `openssl rand -hex 32`.
4. Backup-Schlüssel: `age-keygen -o crm-backup.key` auf einem **separaten** Rechner; nur den öffentlichen Schlüssel (`age1…`) als `BACKUP_AGE_RECIPIENT` eintragen; privaten Schlüssel im Tresor/offline ablegen.
5. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` (mit lokaler DB zusätzlich `--profile local-db`).
6. Ersten Benutzer anlegen: `docker compose … run --rm app npx tsx --conditions=react-server scripts/user.ts <mail> "<Name>" --agency` (Einmal-Passwort sofort ändern).
7. Prüfen: `curl https://<domain>/api/health?deep=1`, Login, Testmail im capture-Modus.

## Update
1. Release-Notizen/Migrationen lesen (`app/prisma/migrations`). Migrationen mit `DROP` vorher besonders prüfen.
2. Backup manuell auslösen: `docker compose … run --rm backup /usr/local/bin/backup.sh`.
3. `git pull` → `docker compose … up -d --build` (Migration läuft automatisch vor App/Worker).
4. `api/health?deep=1` prüfen, Prozess-Läufe und Freigaben stichprobenartig ansehen.

## Rollback
- **Code ohne Schemaänderung:** vorheriges Image-Tag setzen (`CRM_IMAGE=…`), `up -d`.
- **Mit Schemaänderung:** Migrationen sind vorwärts gerichtet. Entweder Folge-Migration schreiben (bevorzugt) oder Restore des Backups vor dem Update (Datenverlust seit Backup!) → nur nach Freigabe.

## Restore (getestet)
1. **Leere** Ziel-Datenbank anlegen (Skript bricht bei nicht-leerer DB ab).
2. Privaten age-Schlüssel nur temporär bereitstellen.
3. `docker run --rm -e TARGET_DATABASE_URL=… -e AGE_IDENTITY_FILE=/k/key.txt -v <ordner>:/k:ro -e S3_ENDPOINT=… -e S3_BUCKET=… -e S3_ACCESS_KEY=… -e S3_SECRET_KEY=… --entrypoint restore.sh pd-crm-backup latest` (oder Pfad `daily/pd-crm_<zeit>.dump.age`).
4. Prüfsumme wird kontrolliert; danach `DATABASE_URL` umstellen, App/Worker neu starten, `api/health?deep=1`.
5. Schlüsseldatei wieder entfernen. Restore-Probe **quartalsweise** wiederholen und protokollieren.

## Schlüsselrotation
| Geheimnis | Vorgehen | Wirkung |
|---|---|---|
| `APP_SECRET` | neu setzen, App + Worker neu starten | alle Sitzungen ungültig (neu anmelden); alte DOI-/Abmeldelinks ungültig → nur bei Verdacht rotieren |
| `MAIL_EVENTS_SECRET` | neu setzen, Webhook-URL beim Relay anpassen | kurze Lücke bei Bounce-Meldungen |
| DB-Passwort | in STACKIT ändern, `DATABASE_URL` in App/Worker/Backup aktualisieren | Neustart |
| API-Schlüssel (Sub-Accounts) | in der Oberfläche widerrufen/neu anlegen | Produkte mit neuem Schlüssel versorgen |
| Backup-age-Schlüssel | neues Schlüsselpaar, `BACKUP_AGE_RECIPIENT` tauschen | alte Backups bleiben mit altem Schlüssel lesbar → alten privaten Schlüssel aufbewahren, bis die Aufbewahrung abgelaufen ist |
| S3-Zugang | neuen Zugang anlegen, Backup-Variablen tauschen, alten löschen | – |

## Störungsfälle
**Worker steht** (`worker: veraltet/fehlt`): Logs (`level":"error"`), Neustart des Worker-Containers. Hängende Jobs werden nach 10 min automatisch neu aufgenommen. Gescheiterte Jobs: Tabelle `Job` mit `status='failed'` (lastError ansehen).

**Outbox-Stau** (`ereignisse: stau`): Ungeprüfte Ereignisse älter als 5 min > 100. Ursachen: Worker steht, fehlerhafter Prozess, DB-Last. `SELECT type, count(*), max(error) FROM "CrmEvent" WHERE "processedAt" IS NULL GROUP BY 1;` Ereignisse mit 5 Fehlversuchen bleiben sichtbar liegen → Ursache beheben, dann `attempts` auf 0 setzen.

**Mail-Bounces/Spam-Beschwerden:** Sperrliste in *API & Integrationen → Sperrliste*. Steigende Bounce-Raten: Listenqualität prüfen, Kampagnen pausieren, SPF/DKIM/DMARC im Pflichten-Cockpit prüfen. Relay-Ereignisse kommen nur an, wenn `MAIL_EVENTS_SECRET` beim Relay korrekt hinterlegt ist.

**Login-/API-Sperren (429):** Rate-Limits liegen in `RateLimitBucket` (Fenster laufen automatisch ab). Hinter einem zusätzlichen Proxy/CDN `TRUST_PROXY` erhöhen, sonst teilen sich alle Besucher eine IP.

**HTTPS-Zertifikat:** Caddy/cert-manager erneuern automatisch; bei Fehlern DNS und Port 80 prüfen.

## Beobachtbarkeit
- App/Worker schreiben **JSON-Zeilen** (`ts`, `level`, `msg`, Felder) ohne personenbezogene Daten (Logger `src/lib/log.ts` maskiert verdächtige Felder). Caddy loggt ebenfalls JSON.
- Sammeln mit **STACKIT Observability** (Starter genügt für den Anfang). LLM-Traces später über selbst betriebenes Langfuse (siehe PRP Beobachtbarkeit) – keine US-SaaS.
- Alarme mindestens: `api/health?deep=1` ≠ 200 für 5 min, Backup älter als 26 h, Fehler-Logs > Schwelle, Zertifikat < 14 Tage.

## Checkliste vor Go-live
- [ ] Security-Review (Code, Konfiguration) und **DAST/Pentest** gegen die Staging-Umgebung (HawkScan o. ä.), Findings behoben
- [ ] Rollen/Berechtigungen geprüft (parallel in Arbeit)
- [ ] `MAIL_MODE=live` erst nach SPF/DKIM/DMARC je Absenderdomain und Test an interne Adressen
- [ ] **AVV** (Art. 28 DSGVO) mit STACKIT und ggf. Mail-Relay, **TOMs** dokumentiert, Verzeichnis der Verarbeitungstätigkeiten
- [ ] **Datenschutzerklärung** inkl. Analytics-Beschreibung (cookiefrei, rechtliche Bewertung der Einwilligungsfrage), Impressum je Sub-Account
- [ ] Restore-Probe erfolgreich, Backup-Alarm aktiv
- [ ] Monitoring/Alarme aktiv, Rufbereitschaft geklärt
- [ ] Ersten Admin angelegt, Einmal-Passwort geändert, keine Testdaten/Test-Schlüssel

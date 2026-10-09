# Betrieb: Sicherung, Wiederherstellung, Update

[English](../en/operations.md)

Das ausführliche Runbook mit Störungsfällen steht in [`docs/Betrieb.md`](../Betrieb.md). Diese Seite fasst die wichtigsten Abläufe für die Compose-Variante zusammen. Alle Befehle laufen im Ordner `deploy/compose` und beginnen mit:

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
```

## Gesundheit

- `GET /api/health`: App läuft (für Load-Balancer).
- `GET /api/health?deep=1`: zusätzlich Datenbank, Worker-Herzschlag (alle 30 s) und Ereignis-Stau. Erwartet: `200` und `worker: ok`.
- Logs sind JSON-Zeilen ohne personenbezogene Daten: `$DC logs -f app worker`.

Empfohlene Alarme: Health ≠ 200 länger als 5 Minuten, Backup älter als 26 Stunden, Fehler-Logs über einer Schwelle, TLS-Zertifikat läuft in weniger als 14 Tagen ab.

## Sicherung

Der Dienst `backup` erstellt täglich um `BACKUP_HOUR_UTC` (Standard 02:00 UTC):

1. `pg_dump` im Custom-Format,
2. verschlüsselt mit dem **öffentlichen** age-Schlüssel (`BACKUP_AGE_RECIPIENT`),
3. Upload nach S3 in `daily/`, sonntags zusätzlich `weekly/`, am Monatsersten `monthly/`, jeweils mit SHA-256-Prüfsumme,
4. Aufbewahrung: 14 tägliche, 8 wöchentliche, 12 monatliche Sicherungen.

Der private Schlüssel liegt **nicht** auf dem Server. Wer den Server übernimmt, kann alte Sicherungen also nicht lesen.

Sicherung von Hand, zum Beispiel vor einem Update:

```bash
$DC run --rm backup /usr/local/bin/backup.sh
```

**Wichtig:** Die Sicherung umfasst die Datenbank. Hochgeladene Dateien (Logos, Brandbooks, Anhänge) liegen im Dateispeicher. Nutze dafür einen S3-Bucket (`S3_*`) mit eingeschalteter Versionierung, oder sichere den Ordner `FILE_STORAGE_DIR` separat.

## Wiederherstellung

1. Eine **leere** Ziel-Datenbank anlegen (das Skript bricht bei einer nicht leeren Datenbank ab) und die Extensions `vector` und `pg_trgm` aktivieren.
2. Den privaten age-Schlüssel nur für die Dauer der Wiederherstellung bereitstellen.
3. Wiederherstellen:
   ```bash
   docker run --rm \
     -e TARGET_DATABASE_URL='postgresql://…' \
     -e AGE_IDENTITY_FILE=/k/key.txt -v /pfad/zum/schluessel:/k:ro \
     -e S3_ENDPOINT=… -e S3_BUCKET=… -e S3_ACCESS_KEY=… -e S3_SECRET_KEY=… \
     --entrypoint restore.sh kundrio-backup:latest latest
   ```
   Statt `latest` geht auch ein Pfad wie `daily/kundrio_<zeit>.dump.age`. Die Prüfsumme wird kontrolliert.
4. `DATABASE_URL` auf die neue Datenbank umstellen, App und Worker neu starten, `api/health?deep=1` prüfen.
5. Die Schlüsseldatei wieder entfernen.

Die Wiederherstellung sollte **vierteljährlich** geprobt und das Ergebnis protokolliert werden.

## Update

1. Release-Notizen und neue Migrationen in `app/prisma/migrations` lesen. Migrationen, die etwas löschen (`DROP`), besonders prüfen.
2. Sicherung von Hand auslösen (siehe oben).
3. Code holen und neu starten:
   ```bash
   git pull
   $DC up -d --build
   ```
   Der Dienst `migrate` führt `prisma migrate deploy` aus, bevor App und Worker starten.
4. `api/health?deep=1` prüfen und stichprobenartig Prozess-Läufe und Freigaben ansehen.

## Rollback

- **Ohne Schemaänderung:** vorheriges Image setzen (`CRM_IMAGE=…`) und `$DC up -d`.
- **Mit Schemaänderung:** Migrationen laufen nur vorwärts. Entweder eine Folge-Migration schreiben (bevorzugt) oder die Sicherung von vor dem Update wiederherstellen. Dabei gehen alle Daten seit der Sicherung verloren.

## Schlüssel wechseln

| Geheimnis | Vorgehen | Wirkung |
|---|---|---|
| `APP_SECRET` | neu setzen, App und Worker neu starten | Alle Sitzungen enden, alte DOI- und Abmeldelinks werden ungültig, gespeicherte Anbieter-Zugangsdaten müssen neu eingetragen werden. Nur bei Verdacht wechseln. |
| `MAIL_EVENTS_SECRET` | neu setzen, Webhook-URL beim Relay anpassen | kurze Lücke bei Bounce-Meldungen |
| Datenbank-Passwort | beim Anbieter ändern, `DATABASE_URL` anpassen | Neustart |
| API-Schlüssel der Sub-Accounts | in der Oberfläche widerrufen und neu anlegen | angebundene Anwendungen umstellen |
| Backup-Schlüssel | neues age-Schlüsselpaar, `BACKUP_AGE_RECIPIENT` tauschen | alten privaten Schlüssel aufbewahren, bis die alten Sicherungen abgelaufen sind |
| S3-Zugang | neuen Zugang anlegen, Variablen tauschen, alten löschen | – |

## Häufige Störungen

- **Worker steht** (`worker: veraltet/fehlt`): Logs ansehen und den Worker neu starten. Hängende Jobs werden nach 10 Minuten automatisch neu aufgenommen. Fehlgeschlagene Jobs stehen in der Tabelle `Job` mit `status='failed'`.
- **Ereignis-Stau**: mehr als 100 unverarbeitete Ereignisse, die älter als 5 Minuten sind. Ursache ist meist ein stehender Worker oder ein fehlerhafter Prozess. Details stehen im Runbook.
- **429 bei Anmeldung oder API**: Das Rate-Limit greift. Steht ein weiterer Proxy oder ein CDN vor Caddy, muss `TRUST_PROXY` erhöht werden.
- **Zertifikat**: Caddy erneuert automatisch. Bei Fehlern DNS und die Erreichbarkeit von Port 80 prüfen.

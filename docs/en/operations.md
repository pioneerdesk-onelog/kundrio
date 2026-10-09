# Operations: backup, restore, upgrade

[Deutsch](../de/betrieb.md)

The detailed runbook including incident handling is in [`docs/Betrieb.md`](../Betrieb.md) (German). This page summarises the most important procedures for the Compose setup. All commands run in `deploy/compose` and start with:

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
```

## Health

- `GET /api/health`: the app is running (for load balancers).
- `GET /api/health?deep=1`: additionally checks the database, the worker heartbeat (every 30 s) and the event backlog. Expected: `200` and `worker: ok`.
- Logs are JSON lines without personal data: `$DC logs -f app worker`.

Recommended alerts: health ≠ 200 for more than 5 minutes, backup older than 26 hours, error logs above a threshold, TLS certificate expiring in less than 14 days.

## Backup

The `backup` service runs daily at `BACKUP_HOUR_UTC` (default 02:00 UTC):

1. `pg_dump` in custom format,
2. encrypted with the **public** age key (`BACKUP_AGE_RECIPIENT`),
3. uploaded to S3 under `daily/`, on Sundays also `weekly/`, on the first of the month also `monthly/`, each with a SHA-256 checksum,
4. retention: 14 daily, 8 weekly, 12 monthly backups.

The private key is **not** on the server. Whoever takes over the server cannot read old backups.

Manual backup, for example before an upgrade:

```bash
$DC run --rm backup /usr/local/bin/backup.sh
```

**Important:** the backup covers the database. Uploaded files (logos, brand books, attachments) live in the file storage. Use an S3 bucket (`S3_*`) with versioning enabled, or back up the `FILE_STORAGE_DIR` folder separately.

## Restore

1. Create an **empty** target database (the script aborts if the database is not empty) and enable the `vector` and `pg_trgm` extensions.
2. Provide the private age key only for the duration of the restore.
3. Restore:
   ```bash
   docker run --rm \
     -e TARGET_DATABASE_URL='postgresql://…' \
     -e AGE_IDENTITY_FILE=/k/key.txt -v /path/to/key:/k:ro \
     -e S3_ENDPOINT=… -e S3_BUCKET=… -e S3_ACCESS_KEY=… -e S3_SECRET_KEY=… \
     --entrypoint restore.sh kundrio-backup:latest latest
   ```
   Instead of `latest` you can pass a path such as `daily/kundrio_<time>.dump.age`. The checksum is verified.
4. Point `DATABASE_URL` to the new database, restart app and worker, check `api/health?deep=1`.
5. Remove the key file again.

Test the restore **quarterly** and record the result.

## Upgrade

1. Read the release notes and new migrations in `app/prisma/migrations`. Check migrations that delete something (`DROP`) with particular care.
2. Trigger a manual backup (see above).
3. Pull the code and restart:
   ```bash
   git pull
   $DC up -d --build
   ```
   The `migrate` service runs `prisma migrate deploy` before app and worker start.
4. Check `api/health?deep=1` and spot-check process runs and approvals.

## Rollback

- **Without schema change:** set the previous image (`CRM_IMAGE=…`) and run `$DC up -d`.
- **With schema change:** migrations only go forward. Either write a follow-up migration (preferred) or restore the backup taken before the upgrade. All data since that backup will be lost.

## Rotating secrets

| Secret | Procedure | Effect |
|---|---|---|
| `APP_SECRET` | set a new value, restart app and worker | All sessions end, old double opt-in and unsubscribe links become invalid, stored provider credentials must be entered again. Rotate only on suspicion. |
| `MAIL_EVENTS_SECRET` | set a new value, update the webhook URL at the relay | short gap in bounce notifications |
| Database password | change at the provider, update `DATABASE_URL` | restart |
| Sub-account API keys | revoke and create new ones in the UI | update connected applications |
| Backup key | new age key pair, replace `BACKUP_AGE_RECIPIENT` | keep the old private key until the old backups have expired |
| S3 credentials | create new credentials, replace variables, delete the old ones | – |

## Common incidents

- **Worker stopped** (`worker: stale/missing`): check the logs and restart the worker. Stuck jobs are picked up again automatically after 10 minutes. Failed jobs are in the `Job` table with `status='failed'`.
- **Event backlog**: more than 100 unprocessed events older than 5 minutes. Usually a stopped worker or a faulty process. Details in the runbook.
- **429 on sign-in or API**: the rate limit applies. If there is another proxy or CDN in front of Caddy, increase `TRUST_PROXY`.
- **Certificate**: Caddy renews automatically. On errors, check DNS and that port 80 is reachable.

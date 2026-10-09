#!/usr/bin/env bash
# Verschlüsseltes Datenbank-Backup nach S3-kompatiblem Speicher.
#   Pflicht: DATABASE_URL, BACKUP_AGE_RECIPIENT (öffentlicher age-Schlüssel, "age1…"),
#            S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
#   Optional: BACKUP_PREFIX (Standard: kundrio), KEEP_DAILY=14, KEEP_WEEKLY=8, KEEP_MONTHLY=12
# Der private age-Schlüssel liegt NICHT auf dem Server – nur so kann ein kompromittierter Server
# alte Backups nicht entschlüsseln. Zusätzlich zu den Backups von PostgreSQL Flex (Exit-Fähigkeit).
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"
PREFIX="${BACKUP_PREFIX:-kundrio}"
KEEP_DAILY="${KEEP_DAILY:-14}"; KEEP_WEEKLY="${KEEP_WEEKLY:-8}"; KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${PREFIX}_${TS}.dump.age"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

log() { printf '{"ts":"%s","level":"%s","msg":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2"; }

# shellcheck source=/dev/null
. /usr/local/bin/s3env.sh

log info "backup start"
# Custom-Format: komprimiert, selektiver Restore möglich; Rechte/Besitzer weglassen (Managed-DB-tauglich)
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$TMP/$FILE"
SIZE=$(stat -c %s "$TMP/$FILE")
[ "$SIZE" -gt 1024 ] || { log error "backup suspiciously small"; exit 1; }
sha256sum "$TMP/$FILE" | awk '{print $1}' > "$TMP/$FILE.sha256"

upload() { rclone copyto "$TMP/$FILE" "bk:$S3_BUCKET/$1/$FILE" && rclone copyto "$TMP/$FILE.sha256" "bk:$S3_BUCKET/$1/$FILE.sha256"; }
upload daily
# Sonntags zusätzlich wöchentlich, am 1. des Monats zusätzlich monatlich
if [ "$(date -u +%u)" = "7" ] || [ "${FORCE_ALL_TIERS:-}" = "1" ]; then upload weekly; fi
if [ "$(date -u +%d)" = "01" ] || [ "${FORCE_ALL_TIERS:-}" = "1" ]; then upload monthly; fi
log info "backup uploaded ($SIZE bytes)"

# Aufbewahrung: je Stufe nur die neuesten N Backups behalten
prune() {
  local dir="$1" keep="$2"
  # grep ohne Treffer (Stufe noch leer, z. B. weekly/monthly in den ersten Wochen) darf mit pipefail nicht abbrechen
  rclone lsf "bk:$S3_BUCKET/$dir/" 2>/dev/null | { grep -E "^${PREFIX}_.*\.dump\.age$" || true; } | sort -r \
    | tail -n +"$((keep + 1))" | while read -r old; do
        rclone deletefile "bk:$S3_BUCKET/$dir/$old" || true
        rclone deletefile "bk:$S3_BUCKET/$dir/$old.sha256" || true
      done
}
prune daily "$KEEP_DAILY"; prune weekly "$KEEP_WEEKLY"; prune monthly "$KEEP_MONTHLY"
log info "backup done"

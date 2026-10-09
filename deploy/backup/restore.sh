#!/usr/bin/env bash
# Stellt ein Backup in eine Ziel-Datenbank wieder her.
#   restore.sh <s3-pfad relativ zum Bucket, z. B. daily/kundrio_20261007T020000Z.dump.age | latest>
#   Pflicht: TARGET_DATABASE_URL, AGE_IDENTITY_FILE (privater age-Schlüssel, nur für den Restore bereitstellen),
#            S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
# Sicherheitsregel: Ziel-DB muss leer sein (keine Tabellen), sonst Abbruch – nie versehentlich Produktion überschreiben.
set -euo pipefail
: "${TARGET_DATABASE_URL:?}" "${AGE_IDENTITY_FILE:?}" "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"
SRC="${1:?Backup-Pfad oder latest angeben}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# shellcheck source=/dev/null
. /usr/local/bin/s3env.sh

if [ "$SRC" = "latest" ]; then
  SRC="daily/$(rclone lsf "bk:$S3_BUCKET/daily/" | grep '\.dump\.age$' | sort | tail -1)"
fi
echo "Restore von: $SRC"

TABLES=$(psql "$TARGET_DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$TABLES" != "0" ]; then echo "Abbruch: Ziel-Datenbank ist nicht leer ($TABLES Tabellen)."; exit 2; fi

rclone copyto "bk:$S3_BUCKET/$SRC" "$TMP/$(basename "$SRC")" && rclone copyto "bk:$S3_BUCKET/$SRC.sha256" "$TMP/$(basename "$SRC").sha256"
F="$TMP/$(basename "$SRC")"
[ "$(sha256sum "$F" | awk '{print $1}')" = "$(cat "$F.sha256")" ] || { echo "Prüfsumme stimmt nicht – Abbruch."; exit 3; }

# Erweiterungen zuerst (pgvector), dann Daten
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -qc "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
age --decrypt --identity "$AGE_IDENTITY_FILE" "$F" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_DATABASE_URL"
echo "Restore abgeschlossen. Tabellen: $(psql "$TARGET_DATABASE_URL" -tAc "select count(*) from information_schema.tables where table_schema='public'")"

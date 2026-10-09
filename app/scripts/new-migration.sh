#!/usr/bin/env bash
# Erzeugt eine Migration aus dem Unterschied DB ↔ Schema. Bricht ab bei ungültigem Schema oder leerem Diff.
set -euo pipefail
name="${1:?Name der Migration angeben}"
cd "$(dirname "$0")/.."
npx prisma validate >/dev/null
npx prisma format >/dev/null
sql="$(npx prisma migrate diff --from-url "$(grep '^DATABASE_URL' .env | cut -d'"' -f2)" --to-schema-datamodel prisma/schema.prisma --script 2>/dev/null | grep -vE 'hnsw|trgm|^warn|^For more' || true)"
if ! grep -qE '^(CREATE|ALTER|DROP|UPDATE)' <<<"$sql"; then echo "Keine Änderungen – keine Migration erzeugt."; exit 1; fi
if grep -qE '^DROP|DROP COLUMN' <<<"$sql"; then echo "ACHTUNG: Diff enthält DROP – bitte von Hand prüfen:"; echo "$sql"; exit 2; fi
dir="prisma/migrations/$(date +%Y%m%d%H%M%S)_${name}"
mkdir "$dir"; printf '%s\n' "$sql" > "$dir/migration.sql"
echo "Migration erzeugt: $dir"; cat "$dir/migration.sql"
npx prisma migrate deploy
npx prisma generate >/dev/null

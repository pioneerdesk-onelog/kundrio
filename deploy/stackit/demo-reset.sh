#!/usr/bin/env bash
# Nächtlicher Neuaufbau der Demo (cron 03:30): Datenbank leeren, Migrationen, Testdaten, Gastkonto.
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose -f docker-compose.yml --env-file /run/kundrio/compose.env "$@"; }
dc stop demo-app demo-worker
dc exec -T demo-db psql -U demo -d postgres -qc "DROP DATABASE IF EXISTS demo WITH (FORCE)" -c "CREATE DATABASE demo OWNER demo"
dc exec -T demo-db psql -U demo -d demo -qc "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
# Einmal-Container (root) für Migration und Seeds; Seeds sind nur Testdaten unter example.*
# Der Seed schreibt Anmeldedaten nach /app/e2e – im schreibgeschützten Image ein Wegwerf-tmpfs
run() { dc run --rm --no-deps -T --user root --entrypoint "" --volume /app/e2e demo-app "$@"; }
run sh -c 'rm -rf /data/files/* && chown 1001:1001 /data/files'
run npx prisma migrate deploy
run npx tsx prisma/seed.ts
run npx tsx --conditions=react-server scripts/seed-e2e.ts
run npx tsx scripts/demo-guest.ts
dc up -d demo-app demo-worker
echo "Demo neu aufgebaut: $(date -Is)"

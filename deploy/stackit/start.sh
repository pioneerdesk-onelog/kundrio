#!/usr/bin/env bash
# Start/Update auf der VM (root, über kundrio.service): Secrets holen → Images bauen → Stack starten.
set -euo pipefail
cd "$(dirname "$0")"
./fetch-secrets.sh
# Werte, die Compose selbst einsetzt (Caddy, Demo-DB), aus den Secrets ableiten – nur im tmpfs
umask 077
# Kontakt für Let's Encrypt je Server in /etc/kundrio/host.env (ACME_EMAIL=…), nicht im Repo
[ -f /etc/kundrio/host.env ] && source /etc/kundrio/host.env
{
  echo "ACME_EMAIL=${ACME_EMAIL:?ACME_EMAIL in /etc/kundrio/host.env setzen}"
  grep '^CADDY_ASK_SECRET=' /run/kundrio/app.env
  grep '^DEMO_DB_PASSWORD=' /run/kundrio/demo.env
} > /run/kundrio/compose.env
dc() { docker compose -f docker-compose.yml --env-file /run/kundrio/compose.env "$@"; }
dc build
dc up -d --remove-orphans
# Datei-Volume der Demo gehört dem App-Benutzer (uid 1001)
dc exec -T --user root demo-app chown 1001:1001 /data/files
dc ps --format '{{.Service}}: {{.State}}'

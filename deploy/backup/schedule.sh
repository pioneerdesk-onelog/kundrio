#!/usr/bin/env bash
# Einfache Zeitsteuerung für Compose (ohne Cron): täglich um BACKUP_HOUR_UTC (Standard 2) ein Backup.
set -uo pipefail
HOUR="${BACKUP_HOUR_UTC:-2}"
while true; do
  now=$(date -u +%s); next=$(date -u -d "today ${HOUR}:00" +%s); [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  /usr/local/bin/backup.sh || echo '{"level":"error","msg":"backup failed"}'
done

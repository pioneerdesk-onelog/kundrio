#!/usr/bin/env bash
# Holt die Geheimnisse aus dem STACKIT Secrets Manager (Vault-API) in den Arbeitsspeicher (/run = tmpfs).
# Zugang: /etc/kundrio/sm.env (root, 600) mit SM_USER, SM_PASSWORD, SM_INSTANCE – Nur-Lese-Benutzer.
# Ergebnis: /run/kundrio/<pfad>.env je Pfad (app, backup, demo), Rechte 600. Nichts landet auf der Platte.
set -euo pipefail
# shellcheck disable=SC1091
source /etc/kundrio/sm.env
API="${SM_API:-https://prod.sm.eu01.stackit.cloud}"
OUT=/run/kundrio
umask 077
mkdir -p "$OUT"

TOKEN=$(curl -fsS -X POST "$API/v1/auth/userpass/login/$SM_USER" \
  -H 'content-type: application/json' -d "$(jq -n --arg p "$SM_PASSWORD" '{password:$p}')" | jq -r .auth.client_token)
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "Anmeldung am Secrets Manager fehlgeschlagen" >&2; exit 1; }

for path in ${SM_PATHS:-app backup demo}; do
  json=$(curl -fsS -H "X-Vault-Token: $TOKEN" "$API/v1/$SM_INSTANCE/data/$path") || { echo "Pfad $path fehlt" >&2; exit 1; }
  # Zeilenumbrüche in Werten sind im env-Format nicht erlaubt → abbrechen statt still kürzen
  echo "$json" | jq -e '[.data.data[] | tostring | test("\n")] | any | not' >/dev/null || { echo "Wert mit Zeilenumbruch in $path" >&2; exit 1; }
  echo "$json" | jq -r '.data.data | to_entries[] | "\(.key)=\(.value)"' > "$OUT/$path.env.tmp"
  mv "$OUT/$path.env.tmp" "$OUT/$path.env"
  echo "Secrets-Pfad $path: $(wc -l < "$OUT/$path.env") Werte"
done
curl -fsS -X POST -H "X-Vault-Token: $TOKEN" "$API/v1/auth/token/revoke-self" >/dev/null || true

# Betrieb auf STACKIT SKE (Kubernetes)

> Vorher prüfen: `kubectl config current-context` zeigt auf den **richtigen** Cluster. Nie versehentlich in einen fremden Cluster anwenden.

## 1. Voraussetzungen (einmal je Cluster)
- SKE-Cluster EU01, Nodes z. B. `g1r.2d` (arm64, 2 vCPU/8 GB) – Image ist multi-arch fähig (siehe Build).
- kubeconfig: `stackit ske kubeconfig create <cluster> --project-id <id>` (kurzlebig, regelmäßig erneuern).
- ingress-nginx (LoadBalancer mit `externalTrafficPolicy: Local`, damit die Client-IP erhalten bleibt) und cert-manager:
  ```
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace \
    --set controller.service.externalTrafficPolicy=Local
  helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true
  kubectl apply -f deploy/k8s/secret.example.yaml   # nur den ClusterIssuer-Teil, E-Mail anpassen
  ```

## 2. Datenbank: STACKIT PostgreSQL Flex
- Flavor-Empfehlung (Kosten: `wiki/kostenbasis.md`): Start **2.4 Single** (≈ 91 €/Monat), ab erstem zahlenden Kunden **4.8 Replica** (HA, ≈ 272 €/Monat).
- Version 17, ACL nur für die SKE-Egress-IPs, TLS (`sslmode=require`).
- **pgvector aktivieren** (in Flex unterstützt, PG 14–18): als DB-Owner `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;` – danach laufen die Migrationen.
- **Embeddings:** Das Schema nutzt `vector(1024)`. EU-Modelle mit 4.096 Dimensionen (E5 Mistral) passen **nicht** (HNSW max. 2.000) → STACKIT „Qwen3 VL Embedding“ auf 1.024 Dimensionen einstellen oder qwen3-embedding selbst betreiben. Modellwechsel = Reindex.

## 3. Image bauen und in die STACKIT Container Registry schieben
```
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/kundrio:<tag> --push app/
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/kundrio-backup:<tag> --push deploy/backup/
```
Pull-Secret anlegen, falls die Registry privat ist (`imagePullSecrets` im Overlay ergänzen).

## 4. Geheimnisse
```
kubectl create namespace kundrio
kubectl -n kundrio create secret generic kundrio-secrets --from-env-file=secrets.env
kubectl -n kundrio create secret generic kundrio-backup-secrets --from-env-file=backup.env
```
Inhalte: siehe `secret.example.yaml`. Werte nie committen.

## 5. Ausrollen
Overlay anlegen (Domain, Image-Tag):
```
mkdir -p deploy/k8s/overlays/prod && cd deploy/k8s/overlays/prod
kustomize create --resources ../../base
kustomize edit set image kundrio=<registry>/kundrio:<tag> kundrio-backup=<registry>/kundrio-backup:<tag>
# Patches für Domain: ConfigMap APP_URL + Ingress host/tls
```
Reihenfolge bei jedem Update:
```
kubectl apply -k deploy/k8s/overlays/prod                       # Manifeste (inkl. Migrations-Vorlage)
kubectl -n kundrio create job migrate-$(date +%s) --from=cronjob/kundrio-migrate
kubectl -n kundrio wait --for=condition=complete --timeout=300s job/<name>
kubectl -n kundrio rollout status deploy/kundrio-app deploy/kundrio-worker
curl -s https://<domain>/api/health?deep=1
```

## 6. Sicherheit im Cluster
- Namespace mit Pod Security „restricted“, Container ohne Root, Dateisystem nur lesbar, keine Capabilities.
- NetworkPolicy: App nur vom Ingress-Namespace erreichbar, Worker/Jobs ohne eingehenden Verkehr.
- Kein ServiceAccount-Token in den Pods.

## 7. Eigene Kundendomains (Landingpages)

Kunden richten im CRM unter *Sub-Account → Domains* z. B. `angebot.kunde.de` ein (CNAME auf `LANDING_CNAME_TARGET`). Die App routet fremde Hosts per `src/middleware.ts` auf die Landingpages; Zertifikate müssen je Kundendomain ausgestellt werden. Zwei Wege:

1. **Caddy als Edge (empfohlen):** Caddy-Deployment mit `on_demand_tls` (siehe `deploy/compose/Caddyfile`) vor dem App-Service, LoadBalancer-Service für Caddy auf Port 80/443, Zertifikatsspeicher als PVC. `ask` zeigt auf `http://crm-app.<ns>.svc:3000/api/domains/ask?secret=$CADDY_ASK_SECRET`. Vorteil: keine Ingress-Änderung je Kunde.
2. **cert-manager je Domain:** Bei Aktivierung einer Domain ein eigenes `Ingress`-Objekt (Host = Kundendomain, `cert-manager.io/cluster-issuer: letsencrypt`) anlegen. Erfordert Schreibrechte der App auf Ingress-Objekte (eigener ServiceAccount, Role nur für `ingresses` im Namespace) – nicht umgesetzt, nur als Alternative dokumentiert.

`LANDING_CNAME_TARGET` muss auf die öffentliche IP des Edge (Caddy bzw. Ingress) zeigen; für Apex-Domains `LANDING_IPV4`/`LANDING_IPV6` setzen. `APP_HOSTS` um alle Plattform-Hostnamen ergänzen, damit sie nicht als Kundendomain behandelt werden.

# Installation

[Deutsch](../de/installation.md)

There are three ways to run Kundrio:

1. **Local development** on your own machine. Everything stays on `127.0.0.1`, and emails land in Mailpit.
2. **Own server with Docker Compose**: one Linux VM running Caddy (HTTPS), app, worker and backup.
3. **STACKIT**: the same Compose setup on a STACKIT VM, with PostgreSQL Flex and Object Storage. Kubernetes manifests for STACKIT SKE are available for larger installations.

## 1. Local development

### Requirements

- Docker with the Compose plugin
- Node.js 20 (see `NODE_VERSION` in `app/Dockerfile`)
- optionally [Ollama](https://ollama.com) for AI features

### Steps

```bash
git clone https://github.com/pioneerdesk-onelog/kundrio.git
cd kundrio
cp infra/searxng/settings.example.yml infra/searxng/settings.yml   # set secret_key in settings.yml
docker compose up -d
```

`docker compose` starts three services, all bound to `127.0.0.1` only:

| Service | Address | Purpose |
|---|---|---|
| PostgreSQL 17 + pgvector | `127.0.0.1:55433` | database, vector search, job queue |
| Mailpit | SMTP `127.0.0.1:51025`, web `http://127.0.0.1:58025` | catches all outgoing email |
| SearXNG | `http://127.0.0.1:58080` | self-hosted meta search for research and press mentions |

Then the app:

```bash
cd app
cp .env.example .env
# set at least APP_SECRET in .env:  openssl rand -hex 32
npm install
npm run db:migrate        # migrations (also creates the vector and pg_trgm extensions)
npm run db:seed           # demo agency with four demo sub-accounts
npm run user:create -- you@example.com "Your Name" --agency
npm run dev:all           # app http://127.0.0.1:3100 + worker
```

`user:create` prints a **one-time password**. Sign in with it and change it right away under *Konto* (account). The first agency user becomes the owner.

### Local AI

```bash
ollama pull qwen3-embedding:0.6b     # embeddings (1024 dimensions, matching the schema)
ollama pull qwen3.6:35b-a3b          # chat model from .env.example – or a smaller one
```

You can choose any chat model via `OLLAMA_CHAT_MODEL`. The embedding model must produce **1024 dimensions** (`EMBED_DIM`). If you switch the embedding model, re-index the knowledge base. Without Ollama, Kundrio keeps working; only the AI features report an error.

### Checks

```bash
npm run typecheck && npm run lint && npm test
npm run e2e        # end-to-end tests (Playwright); they create their own sub-account "e2e"
```

`npm run e2e` additionally needs `E2E_INTERNAL_EMAIL` and `E2E_CUSTOMER_EMAIL` in `.env` (any test addresses, e.g. `@example.com`). With `MAIL_MODE=capture` nothing is sent.

## 2. Own server with Docker Compose

Files: `deploy/compose/docker-compose.prod.yml`, `deploy/compose/Caddyfile`, and the backup image in `deploy/backup/`.

The Compose file starts:

- **caddy**: HTTPS via Let's Encrypt, HSTS, compression, on-demand TLS for custom domains
- **migrate**: runs `prisma migrate deploy` before every start
- **app**: Next.js, 2 replicas by default, read-only file system
- **worker**: jobs, processes, campaigns, event dispatcher
- **backup**: daily `pg_dump`, encrypted with [age](https://age-encryption.org), uploaded to an S3 bucket
- **db** (optional, profile `local-db`): local PostgreSQL with pgvector, if you do not use a managed database

### Steps

1. Linux VM (Debian/Ubuntu) with Docker and the Compose plugin. Firewall: 22 (restricted), 80, 443.
2. DNS: point an A/AAAA record of your domain to the VM.
3. Get the repository onto the VM and create the environment file:
   ```bash
   cd deploy/compose
   touch .env.prod && chmod 600 .env.prod
   ```
   For the content, see [Configuration](configuration.md#production). Generate secrets with `openssl rand -hex 32`.
4. Create the backup key on a **different** machine: `age-keygen -o kundrio-backup.key`. Put only the public key (`age1…`) into `BACKUP_AGE_RECIPIENT`, and keep the private key offline.
5. Start:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   # with a local database:
   docker compose -f docker-compose.prod.yml --env-file .env.prod --profile local-db up -d --build
   ```
6. Create the first user:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm app \
     npx tsx --conditions=react-server scripts/user.ts you@example.com "Your Name" --agency
   ```
7. Check that `curl https://<domain>/api/health?deep=1` returns `200` and reports `worker: ok`. Then sign in and send a test email (in `capture` mode it only lands in the log).

In production, app and worker refuse to start when `APP_SECRET` is shorter than 32 characters, `APP_URL` is not `https`, or `DATABASE_URL`, `MAIL_EVENTS_SECRET` or `TRUST_PROXY` is missing.

## 3. STACKIT

Recommended start: **one STACKIT VM with Docker Compose** (as in section 2) plus managed services:

| Component | STACKIT service | Notes |
|---|---|---|
| Server | Compute Engine (VM) | e.g. 2–4 vCPU, 8 GB RAM |
| Database | PostgreSQL Flex, version 17 | Create the extensions as DB owner: `CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;` · ACL for the VM only · `sslmode=require` |
| Backups and files | Object Storage (S3-compatible) | endpoint `https://object.storage.eu01.onstackit.cloud`; separate bucket for backups |
| AI | AI Model Serving, or your own GPU VM with Ollama | set the embedding model to **1024 dimensions** |
| Secrets | Secrets Manager | inject values into `.env.prod` or the container environment at runtime, never into the repository |
| DNS | STACKIT DNS (optional) | can also manage customer domains, see [Configuration](configuration.md) |

Kubernetes (STACKIT SKE) with ingress-nginx, cert-manager, network policies and the "restricted" pod security level is described in [`deploy/k8s/README.md`](../../deploy/k8s/README.md).

## Go-live checklist

- HTTPS active, `TRUST_PROXY=1` behind Caddy or the ingress
- `MAIL_MODE=live` only after SPF, DKIM and DMARC are correct for every sender domain and a test email to internal addresses arrived
- Data processing agreements (Art. 28 GDPR) with your hoster and mail relay; privacy policy and imprint per sub-account
- Restore tested once (see [Operations](operations.md)), backup alert active
- No test users or test keys left in the database

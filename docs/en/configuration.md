# Configuration

[Deutsch](../de/konfiguration.md)

Kundrio is configured through environment variables. Locally they live in `app/.env` (template: `app/.env.example`), in production in `deploy/compose/.env.prod` or Kubernetes secrets. **Secrets never go into the repository, nor into the database.** Provider credentials per sub-account (payments, WhatsApp, IMAP, etc.) are entered in the UI and stored encrypted.

Column **Secret**: ✅ = treat as confidential (secrets manager, file mode 600), – = not sensitive.

## Basics

| Variable | Purpose | Secret |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection with pgvector. Production: `?sslmode=require` | ✅ (contains password) |
| `APP_SECRET` | Signs sessions, tokens, double opt-in and unsubscribe links, and encrypts stored credentials. At least 32 characters (`openssl rand -hex 32`). Changing it ends all sessions and invalidates old links; stored provider credentials (payments, imports) can no longer be decrypted and must be entered again | ✅ |
| `APP_URL` | Public URL of the app; `https://…` in production | – |
| `APP_HOSTS` | Additional own host names (comma-separated) that must not be treated as customer domains | – |
| `TRUST_PROXY` | Number of trusted reverse proxies in front of the app (Caddy/ingress = `1`). Rate limits and the visitor hash depend on it | – |
| `RATE_LIMIT_STORE` | `memory` (single process) or `db` (multiple instances). Empty: `memory` in development, `db` in production | – |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`. Logs are JSON lines without personal data | – |
| `NODE_ENV` | `production` enables the startup check of the variables | – |
| `SKIP_ENV_CHECK` | `1` skips the startup check; only for the image build | – |
| `FILE_STORAGE_DIR` | Folder for uploaded files (default `app/.data/files`) when no S3 is configured | – |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` | S3-compatible file storage (e.g. STACKIT Object Storage). When set, files are stored in S3 | – |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Bucket credentials (also used for backups) | ✅ |

## AI

| Variable | Purpose | Secret |
|---|---|---|
| `AI_PROVIDER` | `ollama` (default, local) or `openai` for an OpenAI-compatible service such as STACKIT AI Model Serving | – |
| `AI_BASE_URL` | Base URL of the OpenAI-compatible service (only with `openai`; must be `https://`) | – |
| `AI_API_KEY` | Key for the OpenAI-compatible service | ✅ |
| `OLLAMA_BASE_URL` | Ollama server, locally `http://127.0.0.1:11434` | – |
| `OLLAMA_EMBED_MODEL` | Embedding model. Must produce `EMBED_DIM` dimensions; changing it means re-indexing the knowledge base | – |
| `EMBED_DIM` | Vector dimension, fixed at `1024` (schema `vector(1024)`) | – |
| `OLLAMA_CHAT_MODEL` | Chat model for drafts, summaries, translations | – |
| `OLLAMA_CHAT_TIMEOUT_MS`, `OLLAMA_EMBED_TIMEOUT_MS` | Timeouts for AI calls | – |

## Email

| Variable | Purpose | Secret |
|---|---|---|
| `MAIL_MODE` | `capture` (default): everything goes to Mailpit or the log. `live`: real delivery via SMTP | – |
| `MAIL_LIVE_ALLOWLIST` | Only with `live`: comma-separated addresses or `@domain`. When set, only these recipients get real mail and the rest is captured. Empty means everything goes out | – |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP relay. STARTTLS is enforced on port 587 | – |
| `SMTP_USER` | SMTP user | – |
| `SMTP_PASS` | SMTP password | ✅ |
| `SYSTEM_MAIL_FROM` | Sender for mails without a sub-account (invitations), e.g. `Kundrio <crm@example.com>` | – |
| `MAIL_EVENTS_SECRET` | Protects the relay event endpoint (`/api/mail/events/<provider>?secret=…`) for bounces and complaints | ✅ |
| `MAIL_SPF_INCLUDE`, `MAIL_DKIM_SELECTOR`, `MAIL_DKIM_TARGET`, `MAIL_DMARC_RUA` | Expected values for the sender domain check in the compliance cockpit | – |

## Webhooks, research, brand

| Variable | Purpose | Secret |
|---|---|---|
| `WEBHOOK_ALLOW_PRIVATE` | Development only: allow webhooks to private addresses | – |
| `SEARXNG_URL` | Self-hosted SearXNG for enrichment and press mentions | – |
| `SEARXNG_ENGINES` | Preferred search engines, e.g. `mojeek,startpage,duckduckgo` | – |
| `RESEARCH_GDELT` | `off` disables GDELT queries | – |
| `ENRICH_ALLOW_PRIVATE`, `BRAND_FETCH_ALLOW_PRIVATE` | Development/tests only: allow fetching private addresses | – |
| `YOUTUBE_API_KEY` | Public YouTube channel statistics (optional) | ✅ |

## Calendar and video

| Variable | Purpose | Secret |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client for Google Calendar/Meet. Redirect: `<APP_URL>/api/calendar/oauth/google/callback` | – |
| `GOOGLE_CLIENT_SECRET` | its secret | ✅ |
| `MS_CLIENT_ID`, `MS_TENANT` | Microsoft Entra app for calendar/Teams. Redirect: `<APP_URL>/api/calendar/oauth/microsoft/callback` | – |
| `MS_CLIENT_SECRET` | its secret | ✅ |
| `JITSI_BASE_URL` | Jitsi instance for meetings without a calendar connection. Recommendation: your own EU instance instead of `meet.jit.si` | – |
| `OPENTALK_BASE_URL` | Optional OpenTalk instance | – |

## Social channels (read-only)

Redirect URL per platform: `<APP_URL>/api/channels/oauth/<platform>/callback`.

| Variable | Purpose | Secret |
|---|---|---|
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_API_VERSION` | LinkedIn Community Management API | – |
| `LINKEDIN_CLIENT_SECRET` | its secret | ✅ |
| `META_APP_ID`, `META_GRAPH_VERSION` | Facebook pages and Instagram Business | – |
| `META_APP_SECRET` | its secret | ✅ |
| `X_BEARER_TOKEN` | X (paid API) | ✅ |
| `X_MAX_POSTS_PER_SYNC` | Limit of posts per sync | – |
| `TIKTOK_CLIENT_KEY` | TikTok Login Kit / Display API | – |
| `TIKTOK_CLIENT_SECRET` | its secret | ✅ |

## Custom domains and DNS

| Variable | Purpose | Secret |
|---|---|---|
| `LANDING_CNAME_TARGET` | Host name customers point their domain to via CNAME (resolves to Caddy) | – |
| `LANDING_IPV4`, `LANDING_IPV6` | Public addresses for apex domains without CNAME | – |
| `CADDY_ASK_SECRET` | Protects `/api/domains/ask`, which Caddy calls before issuing a certificate | ✅ |
| `DNS_CHECK_RESOLVERS` | Custom resolvers for the domain check (`name=ip,…`) | – |
| `DOMAIN_CONNECT_PROVIDER_ID`, `DOMAIN_CONNECT_SERVICE_ID` | Domain Connect, only after the template is approved by the DNS provider | – |
| `STACKIT_DNS_PROJECT_ID` | STACKIT project where customer zones are created | – |
| `STACKIT_SERVICE_ACCOUNT_KEY_PATH` / `STACKIT_SERVICE_ACCOUNT_KEY` | Service account key (file preferred) | ✅ |
| `STACKIT_PRIVATE_KEY_PATH` | Only with your own key pair | ✅ |
| `STACKIT_DNS_TOKEN` | Development only: fixed token | ✅ |
| `STACKIT_DNS_CONTACT_EMAIL` | Contact address in the zones' SOA | – |

## WhatsApp, SMS, payments, accounting

| Variable | Purpose | Secret |
|---|---|---|
| `MESSAGING_MODE` | `capture` (default) or `live` for WhatsApp/SMS | – |
| `MESSAGING_LIVE_ALLOWLIST` | In live mode, only send to these numbers (E.164) | – |
| `WHATSAPP_GRAPH_BASE`, `SEVEN_API_BASE` | Base URLs; change only for tests/proxies | – |
| `PAYMENTS_MODE` | `test` (default, live keys are rejected) or `live` | – |
| `PAYMENTS_PUBLIC_URL` | Public base URL for webhooks and redirects (empty = `APP_URL`) | – |
| `MOLLIE_API_BASE`, `REVOLUT_MERCHANT_BASE`, `REVOLUT_MERCHANT_API_VERSION`, `UNZER_API_BASE`, `REVOLUT_BUSINESS_BASE` | Provider base URLs; change only for tests/proxies | – |
| `LEXWARE_API_KEY` | Lexware Office Public API | ✅ |
| `LEXWARE_BASE_URL` | Only for tests against a mock server | – |

Each sub-account enters its own payment and messaging credentials in the UI. They are stored encrypted with a key derived from `APP_SECRET`.

## Tests

| Variable | Purpose | Secret |
|---|---|---|
| `E2E_INTERNAL_EMAIL`, `E2E_CUSTOMER_EMAIL` | Required by `npm run e2e:seed`: test addresses for the `e2e` sub-account | – |
| `E2E_SENDER_EMAIL` | Sender in the live mail test (only with `MAIL_MODE=live`) | – |
| `E2E_PASSWORD` | Fixed password of the test users (random otherwise) | ✅ |

## Production

In addition to the app variables, the Compose file (`deploy/compose/docker-compose.prod.yml`) reads these from `.env.prod`:

| Variable | Purpose | Secret |
|---|---|---|
| `CRM_DOMAIN` | Domain of the app (gives `APP_URL=https://<CRM_DOMAIN>`) | – |
| `ACME_EMAIL` | Contact for Let's Encrypt | – |
| `LOCAL_DB_PASSWORD` | Only with profile `local-db` | ✅ |
| `APP_REPLICAS` | Number of app containers (default 2) | – |
| `CRM_IMAGE`, `BACKUP_IMAGE` | Image names/tags | – |
| `BACKUP_AGE_RECIPIENT` | Public age key (`age1…`) for backup encryption | – |
| `BACKUP_HOUR_UTC` | Hour of the daily backup (default 2) | – |
| `KEEP_DAILY`, `KEEP_WEEKLY`, `KEEP_MONTHLY` | Backup retention (14 / 8 / 12) | – |

Minimal `.env.prod` example:

```dotenv
CRM_DOMAIN=crm.example.com
ACME_EMAIL=admin@example.com
DATABASE_URL=postgresql://crm:<password>@<host>:5432/crm?sslmode=require
APP_SECRET=<openssl rand -hex 32>
MAIL_EVENTS_SECRET=<openssl rand -hex 32>
MAIL_MODE=capture
SMTP_HOST=<relay>
SMTP_PORT=587
SMTP_USER=<user>
SMTP_PASS=<password>
AI_PROVIDER=openai
AI_BASE_URL=https://<openai-compatible-endpoint>/v1
AI_API_KEY=<key>
BACKUP_AGE_RECIPIENT=age1...
S3_ENDPOINT=https://object.storage.eu01.onstackit.cloud
S3_BUCKET=kundrio-backups
S3_ACCESS_KEY=<access key>
S3_SECRET_KEY=<secret>
CADDY_ASK_SECRET=<openssl rand -hex 24>
LANDING_CNAME_TARGET=sites.example.com
```

Note: the Compose file only passes the variables listed there to app and worker. If you need more variables from this page (e.g. calendar, payments), add them to the `x-app-env` block.

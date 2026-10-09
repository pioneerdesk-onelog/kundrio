# Architecture

[Deutsch](../de/architektur.md)

## Components

| Part | Technology | Job |
|---|---|---|
| App | Next.js 15 (App Router, Server Actions), React 19 | UI, public pages, APIs, MCP |
| Worker | Node.js, same image as the app | jobs, process engine, event dispatcher, campaigns, AI tasks, analytics import, compliance checks |
| Database | PostgreSQL 17 with pgvector and pg_trgm | business data, vectors (HNSW), job queue, outbox, rate limits |
| Edge | Caddy | HTTPS, HSTS, on-demand TLS for custom domains |
| AI | Ollama or an OpenAI-compatible EU service | embeddings (1024 dimensions), chat |
| Search | SearXNG (self-hosted) | research without tracking |
| Mail | SMTP relay; Mailpit locally | delivery, bounces via webhook |

## Folders

```
app/
  src/app/(admin)/       internal area (sign-in required)
  src/app/(public)/      public pages: login, forms, booking, portal, payment
  src/app/(landing)/     landing pages and custom domains
  src/app/api/           APIs: analytics, agent API, Brevo-compatible, MCP, webhooks, health
  src/lib/               business logic (permissions, processes, mail, invoices, AI, privacy …)
  src/jobs/              worker job handlers
  prisma/                schema, migrations, seed
  scripts/               worker, user creation, migrations, seeds
  e2e/                   Playwright tests and consistency checks
deploy/compose/          production with Docker Compose and Caddy
deploy/k8s/              Kubernetes (STACKIT SKE)
deploy/backup/           backup image (pg_dump + age + rclone)
```

## Core decisions

- **One database for everything.** pgvector instead of a separate vector database, and a job queue with `FOR UPDATE SKIP LOCKED` instead of Redis. Fewer moving parts, transactional consistency, and the tenant filter in the same query.
- **Tenant isolation in every query.** Every business table has `workspaceId`. Pages and server actions load the sub-account via `getWorkspace`/`pageAccess` and check every ID against it. `requireAccess`, `can` and `scopeWhere` check permissions centrally.
- **Transactional outbox.** Business changes write an event (`CrmEvent`) in the same transaction. The worker dispatches events to processes. Steps run exactly once, and external effects happen at most once.
- **Approval principle.** Email defaults to `capture`. Campaigns, processes with external effect and write access via MCP need approval by a person.
- **Own authentication.** scrypt passwords, session tokens stored only as hashes, cookies `httpOnly`/`SameSite=Lax`, no self-registration, no external identity service. OAuth 2.1 only as a server for MCP clients.
- **AI through one place.** All AI calls go through `src/lib/ai.ts`. The log records purpose and model (AI Act). AI makes suggestions, people accept them.
- **Analytics without cookies.** A daily hash with a daily salt, and the IP is used only transiently. AI crawlers are tracked server-side because they do not run JavaScript.
- **No lock-in.** Every import has an equivalent export. The interfaces are compatible with well-known providers (Brevo v3).
- **Landing pages with Puck** (MIT) and Motion. Pages are JSON in Postgres, rendered with Kundrio's own React blocks.

## Data flow: form submission

1. A visitor submits `/f/<id>` → rate limit, validation, contact created or updated, event `form.submitted` (one transaction).
2. With newsletter consent, a confirmation email goes out (at most one per address per hour; captured in `capture` mode).
3. The click on the confirmation link stores `consentEmailAt` and the wording, and writes an event.
4. The worker dispatches the events to published processes (e.g. "Lead-Eingang": task for sales, set lifecycle stage).

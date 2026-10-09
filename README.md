# Kundrio

**A sovereign agency CRM: built for the EU, hosted in Germany, and self-hostable.**

[Deutsch](README.de.md) · [Documentation (EN)](docs/en/README.md) · [Dokumentation (DE)](docs/de/README.md)

Kundrio is a CRM and marketing platform for agencies. It follows the agency/sub-account model you may know from GoHighLevel: one agency manages any number of sub-accounts (clients or projects), each with its own contacts, pipeline, emails, landing pages, automations and invoices. Unlike most tools in this space, Kundrio runs on European infrastructure, with no US cloud services required. AI runs locally (Ollama) or on an EU provider, and every piece of data can be exported again.

> **Status:** feature freeze ahead of the first hosted release. The interface is currently German only.

## Features

| Area | What you get |
|---|---|
| Agency & sub-accounts | Agency overview across all sub-accounts (sales, visibility, AI usage, compliance), roles and permissions per object with scope own/team/all, optional four-eyes approval |
| Contacts & companies | Tags, CSV import/export, timeline, lifecycle stages, owners, domain matching and merge, lead authenticity check, custom fields and lists |
| Sales | Pipeline (kanban, drag and drop, keyboard), tasks, calendar, tickets with SLA |
| Forms | Embeddable forms with double opt-in, rate limit, signed timestamps; the consent wording is stored as proof |
| Email | Single emails and campaigns with a human approval step (draft → approved → sent), unsubscribe header, bounce/complaint handling, suppression list, **Brevo-compatible API** (`/api/brevo/v3/…`) |
| Landing pages | Visual editor (Puck) with 14 blocks incl. booking, animations, AI draft and translation, accessibility check, JSON-LD, sitemap, robots.txt, llms.txt, custom domains with automatic TLS |
| Processes | Flow editor with 27 node types and 28 triggers, versions, test runs, run log, 17 best-practice templates; transactional outbox, so every step runs exactly once |
| Invoices & payments | Quotes, order confirmations, invoices with GiroCode and **XRechnung (UBL)**, online acceptance, customer portal, payment links (Mollie incl. Wero, Revolut, Unzer), subscriptions and **SEPA direct debit** (pain.008), CAMT.053 bank reconciliation, Lexware Office export |
| Shared inbox | Email (IMAP/SMTP), WhatsApp Cloud API, SMS (seven.io); assignment, internal notes, conversation → ticket |
| Booking | Public booking pages with free slots from staff calendars (Google, Microsoft), confirmation + ICS, Jitsi/Meet/Teams links |
| Analytics | Cookie-free, no IP storage; detects AI crawlers and visitors coming from AI answers; conversions and revenue attribution; log import and snippet for external websites |
| AI | Local first (Ollama) or EU provider; knowledge base (RAG with pgvector), drafts, summaries; every call is logged (EU AI Act transparency) |
| MCP & agent API | Admin MCP server with 42 tools for external LLM clients (OAuth 2.1 or API key) plus a public agent API per sub-account; anything with external effect goes to an approval inbox |
| Research | Company and contact enrichment as *suggestions* (website, imprint, social links), press mentions via self-hosted SearXNG, GDELT and RSS |
| Compliance | Obligation cockpit (accessibility act, AI Act, CRA, NIS2, e-invoicing, mail authentication, GDPR) with automatic checks |
| Sovereignty | Sovereignty cockpit (every external connection with region and replacement), full data export (ZIP), AI log, GDPR access (Art. 15) and erasure (Art. 17) per contact |
| Migration | Import from HubSpot (API) and Brevo (API), CSV in both directions; no lock-in |

Not included yet: ZUGFeRD (PDF/A-3), social media publishing, voice.

## Screenshots

_Screenshots will follow with the first release._

<!-- docs/images/overview.png, pipeline.png, page-editor.png, process-editor.png -->

## Quick start (local development)

Requirements: Docker, Node.js 20, optionally [Ollama](https://ollama.com) for AI features.

```bash
git clone https://github.com/pioneerdesk-onelog/kundrio.git && cd kundrio
cp infra/searxng/settings.example.yml infra/searxng/settings.yml
docker compose up -d                 # Postgres + pgvector, Mailpit, SearXNG – bound to 127.0.0.1 only
cd app
cp .env.example .env                 # set APP_SECRET (openssl rand -hex 32)
npm install
npm run db:migrate && npm run db:seed
npm run user:create -- you@example.com "Your Name" --agency   # prints a one-time password
npm run dev:all                      # app on http://127.0.0.1:3100 + background worker
```

All emails go to Mailpit at http://127.0.0.1:58025, so nothing leaves your machine. For AI features, pull the models listed in `.env.example` (`ollama pull qwen3-embedding:0.6b`, plus a chat model).

The full guide, including self-hosting with Docker Compose and deployment on STACKIT, is in [docs/en/installation.md](docs/en/installation.md).

## Architecture

```
Browser ──► Caddy (HTTPS, on-demand TLS for custom domains)
              └─► Next.js 15 app (App Router, Server Actions)   ◄─┐
                                                                 ├── PostgreSQL 17 + pgvector
              Worker (jobs, process engine, outbox, campaigns) ◄─┘    (data, vectors, job queue)
                    ├─► SMTP relay / Mailpit
                    ├─► Ollama or EU AI endpoint
                    └─► SearXNG, payment/calendar/messaging providers (optional)
```

- **One database.** CRM data, vector search (HNSW), the job queue (`FOR UPDATE SKIP LOCKED`) and the event outbox all live in PostgreSQL. No Redis or message broker is needed.
- **Tenant isolation.** Every business table carries a `workspaceId`. Every server action checks the session, the membership and the record's workspace.
- **Human in the loop.** AI makes suggestions and people decide. Anything with external effect (campaigns, webhooks, MCP writes) needs an explicit approval.
- **Stack:** Next.js 15, React 19, Prisma 6, Tailwind 4, TypeScript; Vitest and Playwright for tests.

More details: [docs/en/architecture.md](docs/en/architecture.md).

## Sovereignty and GDPR

- Runs entirely on your own server or on German cloud infrastructure (STACKIT). No US cloud service is required.
- Analytics without cookies or stored IP addresses.
- Email defaults to `capture` mode: nothing is sent until you switch to live mode and approve each campaign.
- Newsletters require double opt-in, and the consent wording is stored as proof.
- Built-in GDPR access export and erasure per contact, plus a full data export per sub-account.
- The sovereignty cockpit lists every outbound connection with its region and a replacement option.

## Documentation

| | English | Deutsch |
|---|---|---|
| Overview | [docs/en](docs/en/README.md) | [docs/de](docs/de/README.md) |
| Installation | [installation](docs/en/installation.md) | [Installation](docs/de/installation.md) |
| Configuration | [configuration](docs/en/configuration.md) | [Konfiguration](docs/de/konfiguration.md) |
| First steps | [getting started](docs/en/getting-started.md) | [Erste Schritte](docs/de/erste-schritte.md) |
| Feature guides | [features](docs/en/features.md) | [Funktionen](docs/de/funktionen.md) |
| Operations, backup, upgrade | [operations](docs/en/operations.md) | [Betrieb](docs/de/betrieb.md) |
| Architecture | [architecture](docs/en/architecture.md) | [Architektur](docs/de/architektur.md) |
| FAQ | [faq](docs/en/faq.md) | [FAQ](docs/de/faq.md) |

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Every contributor must sign the [CLA](CLA.md) once. Report security issues privately as described in [SECURITY.md](SECURITY.md), never in public issues.

## License

Kundrio is **Fair Source** under the [Functional Source License 1.1 with Apache 2.0 future license (FSL-1.1-ALv2)](LICENSE):

- You may use, modify and self-host Kundrio for any purpose **except a competing commercial offering**, for example selling Kundrio itself as a hosted CRM service.
- Explicitly permitted: internal use, non-commercial education and research, and professional services you provide to someone who uses Kundrio under this license (for example installation or migration).
- **Every version becomes Apache-2.0 two years after its release.**

© 2026 Pioneerdesk GmbH. "Kundrio" is a product name of Pioneerdesk GmbH; the license does not grant trademark rights.

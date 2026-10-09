# FAQ

[Deutsch](../de/faq.md)

**Is Kundrio open source?**
Kundrio is *Fair Source* under the FSL-1.1-ALv2. You may read, modify and self-host the code, but you may not build a competing commercial offering with it. Every version becomes Apache-2.0, which is classic open source, two years after its release.

**May I use Kundrio in my company?**
Yes. Internal use is explicitly allowed, including commercial internal use.

**May I run Kundrio for my clients?**
Setup, migration and support for clients who use Kundrio themselves under the license are allowed. Selling Kundrio as your own hosted CRM service is a competing offering and requires a commercial license. If in doubt, please ask.

**Why is the interface German only?**
Kundrio was built for the German market (e-invoicing, SEPA, GDPR, accessibility act). An English interface is welcome; please open an issue first.

**Do I need a GPU?**
No. Without AI, everything except the AI features works. For AI, an OpenAI-compatible EU service or an Ollama server with suitable models is enough. The embedding model must produce 1024 dimensions.

**Will emails reach real recipients while I try it out?**
No. `MAIL_MODE=capture` is the default, and all emails land in Mailpit. For real delivery you must set `MAIL_MODE=live` and approve every campaign. With `MAIL_LIVE_ALLOWLIST` only selected addresses receive real mail.

**Are payments executed?**
Only with `PAYMENTS_MODE=live` and live credentials of the providers. In the default `test` mode, Kundrio rejects live keys.

**How do I create more sub-accounts?**
Currently via `app/prisma/seed.ts` (add an entry to `WORKSPACES`) and `npm run db:seed`. See [Getting started](getting-started.md#2-agency-and-sub-accounts).

**Can I use `prisma migrate dev` or `prisma db push`?**
No. Both drop raw indexes such as the HNSW vector index. Create new migrations only with `./scripts/new-migration.sh <name>`; use `prisma migrate deploy` in production.

**How do I get my data out again?**
*Einstellungen → Datenexport* delivers all data of a sub-account as a ZIP (JSON + CSV). There are also exports in Brevo and HubSpot formats, and the encrypted database backups.

**Where do I report a security issue?**
Privately, as described in [SECURITY.md](../../SECURITY.md), never as a public issue.

**Why does the app refuse to start in production?**
The startup check logs what is missing, for example an `APP_SECRET` that is too short, an `APP_URL` without `https`, or a missing `MAIL_EVENTS_SECRET` or `TRUST_PROXY`. See [Configuration](configuration.md).

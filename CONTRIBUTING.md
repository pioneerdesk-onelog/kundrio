# Contributing to Kundrio

[Deutsch](CONTRIBUTING.de.md)

Thanks for your interest. This guide explains how to propose changes so that they can be merged quickly.

## Before you start

- **Sign the CLA.** Every contributor signs the [Contributor License Agreement](CLA.md) once. The CLA bot comments on your first pull request; reply with the sentence it asks for. Without a signed CLA we cannot merge your contribution.
- **Open an issue first** for anything bigger than a small fix. That way we can agree on the approach before you invest time.
- **Security issues** go to the address in [SECURITY.md](SECURITY.md), never into public issues.

## Development setup

Follow the quick start in the [README](README.md), or the detailed guide in [docs/en/installation.md](docs/en/installation.md). In short:

```bash
docker compose up -d
cd app && cp .env.example .env && npm install
npm run db:migrate && npm run db:seed
npm run dev:all
```

## Checks before every pull request

```bash
cd app
npm run typecheck
npm run lint
npm test            # unit tests; DB tests run when DATABASE_URL is set and the E2E seed exists
npm run build
```

End-to-end tests (`npm run e2e`) seed their own sub-account `e2e` and run all Playwright suites. They need the local Docker services. CI runs typecheck, lint and the unit tests on every pull request.

## Rules for code

These rules keep tenants separated and data consistent. Pull requests that break them will not be merged.

- **Tenant isolation.** Every business table has a `workspaceId`. Load the workspace via `getWorkspace(slug)` / `pageAccess(slug)` and check every ID from a server action against that workspace. Check permissions via `requireAccess` / `can` / `scopeWhere`.
- **Public routes** live only in `(public)/**`, `(landing)/**`, `api/a/**` and `api/agent/**`. Everything else requires a session.
- **Schema changes only via migration:** `./scripts/new-migration.sh <name>`. Never use `prisma db push` or `prisma migrate dev`, because they drop raw indexes such as the HNSW vector index.
- **Events.** Business changes write an event via `emitEvent(…, tx)` in the same transaction (outbox).
- **AI calls** only go through `src/lib/ai.ts`, which logs purpose and model.
- **Long-running work** is a job: `enqueue()` from `src/lib/jobs.ts`, with handlers in `src/jobs/<area>.ts`.
- **Nothing leaves the system without approval.** Email defaults to capture mode; external effects need an approval step.
- **Every bug fix comes with a test** that fails before the fix.
- **UI text is German**, plain and short. English UI translations are welcome as a separate effort; please open an issue first.

## Commits and pull requests

- One topic per pull request, with a clear description of what changes and why, and how you tested it.
- Keep commits focused. Commit messages may be in English or German.
- New dependencies need a reason. Prefer EU-friendly, permissively licensed packages, and avoid packages that phone home.
- Documentation changes are part of the pull request: update `docs/de` **and** `docs/en` when you change behaviour.

## License

By contributing you agree that your contribution is licensed under the project license ([FSL-1.1-ALv2](LICENSE)) and that Pioneerdesk GmbH may relicense it as described in the [CLA](CLA.md).

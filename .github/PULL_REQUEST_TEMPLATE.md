## What and why

<!-- What does this change, and why? Link the issue: Fixes #123 -->

## How was it tested?

<!-- Commands you ran, new or changed tests. Bug fixes need a test that fails before the fix. -->

## Checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass in `app/`
- [ ] New or changed queries are scoped to the workspace (`workspaceId`) and check permissions
- [ ] Schema changes only via `./scripts/new-migration.sh` (no `db push` / `migrate dev`)
- [ ] Nothing leaves the system without approval (mail capture mode, approval steps)
- [ ] Docs updated in `docs/de` **and** `docs/en` if behaviour changed
- [ ] No secrets, personal data or real customer data in code, tests or screenshots
- [ ] I have signed the [CLA](../CLA.md)

# Getting started

[Deutsch](../de/erste-schritte.md)

## Terms

- **Agency**: the top level, i.e. you or your company. The agency overview (`/`) shows figures across all sub-accounts.
- **Sub-account**: a client or one of your own projects. All business data (contacts, deals, emails, pages, invoices …) belongs to exactly one sub-account and is separated from the others. URL: `/sa/<slug>`.
- **Member**: a person with access to a sub-account and a role there.

## 1. Create the first user

There is deliberately no self-registration. The first user is created on the command line:

```bash
cd app
npm run user:create -- you@example.com "Your Name" --agency
```

The output contains a **one-time password**. Sign in at `/login` and change it right away under *Konto* (account). The first agency user becomes the **owner**; every further user created with `--agency` becomes an agency admin. Two-factor authentication is not available yet, so use a long password that you use nowhere else.

With `--workspace <slug>:ADMIN` (or `:MEMBER`) a user gets direct access to a sub-account.

## 2. Agency and sub-accounts

`npm run db:seed` creates the agency and the sub-accounts from `app/prisma/seed.ts`. In the public edition that is a **demo agency** with four demo sub-accounts. Each sub-account gets:

- a sales pipeline (Neu, Kontaktiert, Qualifiziert, Angebot, Gewonnen, Verloren: new, contacted, qualified, proposal, won, lost)
- a ticket pipeline "Support"
- lifecycle stages modelled on HubSpot
- a knowledge page "start"

**Your own sub-accounts:** add them to `WORKSPACES` in `app/prisma/seed.ts` (slug, name, domain, brand colours) and run `npm run db:seed` again. This is safe, because existing sub-accounts are not changed. Afterwards you change name, sender, colours, fonts, region, languages and imprint in the app under *Einstellungen* (settings); the slug stays fixed. A dialog for creating sub-accounts in the UI is planned.

## 3. Set up a sub-account

In the sub-account's *Einstellungen* (settings):

1. **Name, domain, description** and **sender** (name and address for emails).
2. **Legal details**: company name, address, VAT ID, phone, email, imprint. They appear on invoices and landing pages.
3. **Bank details** (IBAN/BIC) for invoices and GiroCode; for direct debits also the **SEPA creditor ID**.
4. **Brand**: colours, fonts, logo (SVG). Optionally upload a brand book or take over the corporate design from the website; the brand voice is used in AI texts.
5. **Region** (DE or EU). The sovereignty cockpit warns when an active connection leaves this region.
6. **Allowed domains** for the analytics snippet and the agent API.
7. **Approvals**: switch the four-eyes principle on or off (default off).

Then check the compliance cockpit (*Pflichten*) for anything still missing.

## 4. Team and roles

**Agency level** (`/benutzer`): owner, admin (access to all sub-accounts) and staff (only assigned sub-accounts). *Person einladen* (invite person) sends an invitation; the person sets their own password via the link.

**Sub-account level** (*Team*): invite people to a sub-account and assign a role. Included role templates:

| Role | Intended for |
|---|---|
| Admin | everything in the sub-account, including settings and users |
| Teamleitung (team lead) | sales and service of their own team, approvals |
| Vertrieb (sales) | own contacts, companies, deals, tasks |
| Service | tickets, inbox, contacts |
| Marketing | email, campaigns, forms, landing pages, analytics |
| Buchhaltung (accounting) | quotes, invoices, subscriptions, payments |
| Nur lesen (read-only) | view without changes |

Roles are templates and can be adjusted under *Team → Rollen*. For every object (contacts, companies, deals, tickets, tasks, invoices, email, lists, forms, pages, knowledge, processes, analytics, compliance) there are **read, edit, delete** permissions with the scope **none, own, team, all**. Special rights such as export, import, granting approvals, publishing processes, sending campaigns, API keys, settings, users and audit are assigned separately.

Rules: nobody can grant rights they do not have themselves, and the last owner is protected.

## 5. First data

- Import contacts via CSV (*Kontakte*, section *CSV-Import*) or migrate from HubSpot or Brevo (*Listen & Felder → Wechsel*).
- Create a form and embed it on your website (see [Features](features.md#forms)).
- Under *Prozesse* (processes), adopt a best-practice template, e.g. "Lead-Eingang" (lead intake).

Continue with the [features](features.md).

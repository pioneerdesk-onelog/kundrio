# Features

[Deutsch](../de/funktionen.md)

All areas are in the sub-account menu (`/sa/<slug>/…`). What you can see and change depends on your role (see [Getting started](getting-started.md#4-team-and-roles)). German menu names are given in italics.

- [Contacts and companies](#contacts-and-companies)
- [Pipeline, tasks, tickets](#pipeline-tasks-tickets)
- [Forms](#forms)
- [Email and campaigns](#email-and-campaigns)
- [Landing pages](#landing-pages)
- [Processes (automation)](#processes-automation)
- [Quotes, invoices, payments](#quotes-invoices-payments)
- [Subscriptions and SEPA direct debit](#subscriptions-and-sepa-direct-debit)
- [Inbox](#inbox)
- [Calendar and booking](#calendar-and-booking)
- [Analytics](#analytics)
- [AI, knowledge, MCP and agent API](#ai-knowledge-mcp-and-agent-api)
- [Research and press](#research-and-press)
- [Compliance cockpit](#compliance-cockpit)
- [Sovereignty cockpit](#sovereignty-cockpit)
- [Data export and GDPR](#data-export-and-gdpr)
- [Migrating from HubSpot or Brevo](#migrating-from-hubspot-or-brevo)

## Contacts and companies

- *Kontakte*: list with search, tags and filters. The detail page shows the timeline (emails, forms, deals, tickets, notes), consents and the processes that affect the contact.
- **CSV import** on the contacts page. Columns are mapped; imports do not trigger processes.
- *Unternehmen* (companies): contacts are matched automatically via their email domain. Duplicate companies can be merged.
- **Lifecycle stages** (subscriber, lead, MQL, SQL, opportunity, customer …) and **owners** per record.
- **Lead authenticity**: Kundrio rates new leads (domain, behaviour) and flags suspicious requests.
- *Listen & Felder* (lists and fields): static lists and custom fields for contacts and companies. Processes and forms can only use fields that actually exist.

## Pipeline, tasks, tickets

- *Pipeline*: deals as kanban. Drag cards with mouse or finger (on phones, press and hold briefly), use the keyboard (space, arrow keys, space), or set the stage via the select on the card. A process can turn the contact of a won deal into a customer.
- *Aufgaben* (tasks): with due date and owner; overdue tasks show up on the dashboard.
- *Tickets*: own pipeline "Support" with priority and SLA. Inbox conversations can be converted into tickets.

## Forms

1. *Formulare* → new form, pick fields (standard and custom fields).
2. For newsletters, enter the **consent text**. Whoever submits the form receives a confirmation email (**double opt-in**). Only after the click is `consentEmailAt` set, and the wording at the time of confirmation is stored as proof.
3. Embed: the form page shows the link (`/f/<id>`) and an `<iframe>` snippet for your website.

Forms have a rate limit against spam and a signed timestamp. New submissions fire the event `form.submitted`, for example for the "Lead-Eingang" process.

## Email and campaigns

- **Single emails** from the contact page. With `MAIL_MODE=capture` they land in Mailpit or the log.
- **Campaigns** (*E-Mail → Kampagne*): recipients from lists or tags, Markdown text with placeholders such as `{{ contact.FIRSTNAME | default: "everyone" }}`, plus a preview. Templates can be sent as a test email.
- **Flow:** *draft* → *approved* (an authorised person approves; with the four-eyes principle someone other than the author) → *sending* → *sent*. The worker sends in batches.
- Newsletters only go to contacts with confirmed consent. Every email has an unsubscribe link and the `List-Unsubscribe` header (one-click).
- **Bounces and complaints** arrive via the relay's event endpoint (`MAIL_EVENTS_SECRET`) and go onto the **suppression list**. The suppression list survives the deletion of a contact.
- **Templates** (*E-Mail → Vorlagen*) with numeric IDs, usable through the Brevo-compatible API.
- **Brevo-compatible API**: `POST /api/brevo/v3/smtp/email` plus the contacts and lists endpoints. Existing applications switch by changing base URL and API key. Create the key under *API & Schnittstellen*.

## Landing pages

1. *Landingpages* → new page, optionally as an **AI draft** from a short description.
2. Arrange blocks in the **editor**: 14 blocks such as hero, text, image, benefits, pricing, FAQ, form, booking, animations. Colours and fonts come from the sub-account's brand.
3. **Accessibility check**: runs before publishing and shows issues (contrast, alt texts, headings).
4. **Translate** into the sub-account's other languages (AI draft, review afterwards).
5. **Publish**: available at `/p/<slug>/<language>/<page>`, with JSON-LD, `sitemap.xml`, `robots.txt` and `llms.txt`.

**Custom domain** (*Domains*): enter the domain. Kundrio detects the DNS provider and creates the record via API, Domain Connect or step-by-step instructions (CNAME to `LANDING_CNAME_TARGET`, A/AAAA for apex domains). After the check via several resolvers, Caddy issues the certificate automatically. The domain is monitored afterwards.

## Processes (automation)

- *Prozesse* shows your processes and **17 best-practice templates** (lead intake, MQL, deal won → customer, welcome, order confirmation, kickoff, booking, returned debit, invoice paid …).
- The **flow editor** connects a **trigger** (28 kinds, e.g. form submitted, deal stage changed, tag added, meeting booked, invoice paid, mention found, AI detection) with **steps** (27 node types: conditions, wait, set field, task, email, webhook, AI step …).
- Every process can also be shown **"in words"**, and the validation reports unknown fields before publishing.
- **Test run** with a sample record, then **publish**. Every publication is a new version; running instances stay on their version.
- Processes with **external effect** (email, webhook) need approval by an admin.
- *Läufe* (runs): log of every run with all steps and errors.

Technically, every business change writes an event to an outbox. The worker dispatches it to matching processes, and every step runs exactly once, even after a crash.

## Quotes, invoices, payments

- *Angebote & Rechnungen* → new: line items, tax, payment terms. Numbers are assigned sequentially.
- **Quote** → sent with PDF → **online acceptance** via a link (`/dokument/<token>`) → **order confirmation** → **invoice**.
- Every invoice has a **GiroCode** (QR code for bank transfer) and can be downloaded as **XRechnung (UBL)**.
- **Texts** (*Angebote & Rechnungen → Texte*): intro, closing and email texts per document type, with placeholders.
- **Customer portal**: customers see their documents via a personal link.
- **Payment links** (*Zahlungen → Anbieter*): connect Mollie (incl. Wero), Revolut or Unzer. With `PAYMENTS_MODE=test` only test credentials are accepted. The link appears on the invoice, in the portal and as the placeholder `{{ invoice.paymentLink }}`. A paid invoice fires `invoice.paid`.
- **Bank reconciliation** (*Zahlungen → Abgleich*): upload a CAMT.053 statement (or connect Revolut Business). Payments are matched to invoices and direct debits automatically; the rest manually.
- **Lexware Office** (*Integrationen*): transfer documents to Lexware (`LEXWARE_API_KEY`).

## Subscriptions and SEPA direct debit

- *Abos → Produkte*: products with price and interval.
- *Abos → Mandate*: SEPA mandates (recurring or one-off, OOFF). The IBAN is stored encrypted. The **creditor ID** is set in the settings.
- *Abos → Lastschrift*: Kundrio creates due invoices and a batch file `pain.008.001.08` that you upload to your bank.
- **Returned debits** are detected via bank reconciliation and fire `debit.returned`; *Mahnwesen* (dunning) shows open items.

## Inbox

- *Posteingang → Kanäle*: connect an email mailbox via IMAP/SMTP, the **WhatsApp Cloud API** or **SMS via seven.io**.
- Assign conversations, write **internal notes**, close them with keyboard shortcuts, convert them into a **ticket**.
- HTML emails are rendered isolated (no scripts, no tracking pixels).
- WhatsApp and SMS need consent per channel. With `MESSAGING_MODE=capture` nothing is sent, only logged.

## Calendar and booking

- *Konto → Kalender*: connect your Google or Microsoft calendar. Kundrio reads free slots and creates events (with a Meet or Teams link).
- *Kalender → Vorlagen*: meeting types with duration, buffer, notice period and participants.
- **Public booking page**: `/buchen/<slug>/<template>`, also as `<iframe>` or as a block on a landing page. After booking, a confirmation with an ICS file is sent; the event `meeting.booked` is available for processes.
- Without a calendar connection, there is a Jitsi link (`JITSI_BASE_URL`) and an ICS invitation by email.

## Analytics

- **No cookies and no stored IP address.** Visitors are counted via a daily hash with a salt that changes every day.
- Landing pages are tracked automatically. For external websites, embed the snippet from *Analytics*:
  ```html
  <script defer src="https://<your-kundrio-domain>/api/a/script.js?ws=<slug>"></script>
  ```
  The website must be listed under *Einstellungen → Erlaubte Domains* (allowed domains).
- **AI crawlers** (GPTBot, ClaudeBot, PerplexityBot …) are detected server-side, even without JavaScript. Visitors coming from AI answers appear as a separate source.
- **Conversions** and revenue attribution, **log import** (*Analytics → Import*) for server logs of external websites.
- Agency analytics (`/analytics`) combines all sub-accounts.

## AI, knowledge, MCP and agent API

- **AI calls** run locally (Ollama) or through an OpenAI-compatible EU service. Every call is logged with purpose and model (*Souveränität → KI-Protokoll*). AI results are always suggestions.
- *Wissen* (knowledge): texts, files and websites as sources, public or internal. Kundrio splits them into chunks and stores vectors in pgvector (RAG).
- *Wiki*: pages per sub-account. The AI proposes changes; a person accepts them.
- **Admin MCP** (`POST /api/mcp`): 42 tools for external AI assistants (search contacts, change deals, build processes …). Authentication via **OAuth 2.1** (for connectors in claude.ai or ChatGPT) or an API key with the scopes `mcp:read` / `mcp:write` (*API & Schnittstellen → MCP*). Effective rights are the intersection of user rights and token scope. Anything with external effect goes to the **approval inbox** (`/freigaben`).
- **Agent API** per sub-account (`/api/agent/<slug>/info|ask|request|openapi.json|mcp`): public interface for visitors' AI agents. Answers come only from public knowledge sources; requests create a contact and a task, never an email directly. Can be switched off in the settings.

## Research and press

- **Enrichment** (detail pages, *Anreicherung*): Kundrio reads the website and imprint, finds linked social profiles and creates an AI profile. Every value is a **suggestion** with source and date; a person accepts it.
- People are enriched only in a professional capacity and only when enabled for the sub-account (information duty under Art. 14 GDPR; objection via the tag `keine-anreicherung`).
- *Presse & Erwähnungen* (press and mentions): hits from SearXNG, GDELT and RSS with AI summary, sentiment and topics. **Monitoring** can be switched on per sub-account and fires `mention.found`.

## Compliance cockpit

*Pflichten* lists the requirements from the German accessibility act (BFSG), AI Act, CRA, NIS2, e-invoicing, mail authentication (SPF/DKIM/DMARC), GDPR and sovereignty. Kundrio checks many items automatically (e.g. DNS records of the sender domain, imprint, consent texts). The rest is ticked off with evidence.

## Sovereignty cockpit

`/souveraenitaet` (agency admins) lists every outbound connection with provider, region, purpose, active/inactive and a replacement option. If an active connection leaves a sub-account's region, a warning appears. Services that only become active when a feature is used are listed separately under "Nur bei Nutzung" (only when used). It also shows AI usage per sub-account and the AI log.

## Data export and GDPR

- **Data export per sub-account** (*Einstellungen → Datenexport*): all data as a ZIP in open formats (JSON and CSV), without passwords and embeddings. A test makes sure every table is included in the export.
- **Access (Art. 15)**: *Auskunft (DSGVO)* on the contact page downloads all data about a person as JSON.
- **Erasure (Art. 17)**: deleting on the contact page removes the person with all references. Where retention duties apply (invoices, mandates, subscriptions), the data is anonymised instead of deleted. The email address stays on the suppression list so that nothing is sent again.
- **Consents** are stored with time, source and wording.

## Migrating from HubSpot or Brevo

*Listen & Felder → Wechsel*:

- **HubSpot**: import via private app token (contacts, companies, deals, properties) or via a HubSpot CSV export.
- **Brevo**: import via API key (contacts, lists, attributes, suppression list) or CSV.
- **Export** in both directions: Brevo- and HubSpot-compatible CSV files and the suppression list, so you can leave Kundrio again.

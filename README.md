# release-notes-agent

AI Product Communications platform. The core value is orchestrating the flow of product knowledge from company communication software into structured, audience-specific documentation.

It reads your deploy-announcements channel, works out what shipped, pulls in the linked Jira tickets, PRs and docs, and writes a **draft** release note for each release for a product person to review and approve. Approved notes show up in your product through a small "What's new" widget.

```
Slack ─► detect deployments ─► retrieve linked context ─► structured notes ─► per-audience ─► Notion draft
 (or Discord)   (Claude)       (Jira, GitHub, docs)      (cited, checked)   instructor/student/internal   (or Google Docs)
```

## The rule it will not break

Release-note text is generated **only when linked sources explain the change.** The Slack message says *what* shipped; only a ticket, PR or doc can say *why* and *how*. If nothing supports an entry, it is marked **Needs review**, restates the announcement and nothing more, and tells the reviewer what is missing. This is enforced in code (`src/pipeline/compose.ts`), not only in the prompt:

- no evidence retrieved, so the model is never asked to write
- the model says the sources don't explain it, so the entry is flagged
- an entry cites no source or cites one that wasn't provided, so it is flagged and the text is discarded
- flagged entries never reach the in-product feed

## Quick start

```bash
npm install
cp .env.example .env        # set ANTHROPIC_API_KEY at minimum
npm run digest              # reads fixtures/deploy-announcements.json, writes out/*.md
npm start                   # review screen at http://localhost:3000
npm test
```

Edit `product.json` with your product's name, summary and areas. Areas are the buckets changes are grouped into; `PRODUCT_SITE_URLS` adds text from your website.

## Swapping Slack, Notion and Jira

Everything vendor-specific lives behind three small interfaces in `src/adapters/types.ts`. Pick adapters with environment variables; add a new vendor by implementing one interface.

| Role | Interface | Included | Env |
| --- | --- | --- | --- |
| Where announcements are read | `ChatSource` | Slack, Discord, JSON file | `CHAT_SOURCE` |
| Where evidence comes from | `ContextProvider` | Jira, GitHub PRs, linked public docs | `CONTEXT_PROVIDERS` |
| Where drafts are written | `DraftPublisher` | Notion, Google Docs, Markdown files | `DESTINATION` |

## Notion setup

1. Create an internal integration at notion.so/profile/integrations and copy its token into `NOTION_TOKEN`.
2. Share a parent page with the integration.
3. `NOTION_TOKEN=... npm run digest -- --setup-notion <parent page id>` creates a "Release notes" database and prints `NOTION_DATA_SOURCE_ID`.
4. Set `DESTINATION=notion`.

Each release becomes a page with Release date, Version, links to the Slack messages and Jira tickets, and sections **For instructors**, **For students** and **For support and success (internal)**. Reviewers edit the page and set **Status** to Approved. `npm run digest -- --sync` (or the **Sync** button, or `RUN_EVERY_MINUTES`) reads the edits back. Entries that still have a "Needs review" callout are left out; deleting the callout signs one off.

## In-product release notes

```html
<script src="https://YOUR-HOST/widget.js" data-audience="instructor" defer></script>
<!-- students: data-audience="student" -->
```

Or call `GET /api/whats-new?audience=student|instructor` and render it yourself. Only approved, sourced entries are returned. Set `WIDGET_ALLOWED_ORIGIN` to your product's origin in production.

## Deploying

It is a single Node 22 process with a JSON-file store. Set `ADMIN_TOKEN` so the review screen and run/approve routes are protected (the `/api/whats-new` feed stays public by design). Use a persistent disk for `STORE_PATH`, or replace `src/store.ts` with a database.

## Not built yet

- Confluence, Notion and Google Docs as *evidence* providers (they need per-source credentials)
- Slack threads (replies under an announcement are not read)
- Live tests against real Slack, Notion, Jira and Google accounts: adapters are covered with fakes only

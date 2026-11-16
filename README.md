# release-notes-agent

AI Product Communications platform. The core value is orchestrating the flow of product knowledge from company communication software into structured, audience-specific documentation.

It works for any software company. It reads your deploy-announcements channel, works out what shipped, pulls in the linked Jira tickets, PRs and docs, and writes a **draft** for each release, with a version of the notes for each team that needs one: Customer Support, Sales, Customer Success, or whoever you define. A product person reviews and approves the draft. If you want, the customer-facing version also shows up in your product through a small "What's new" widget.

```
Slack ─► detect deployments ─► retrieve linked context ─► structured notes ─► one version per audience ─► Notion draft
 (or Discord)   (Claude)       (Jira, GitHub, docs)      (cited, checked)    (support, sales, success, customers)  (or Google Docs)
```

## Audiences

Audiences are yours to define in `audiences.json`. Each one has an `id`, a `label`, a `description` (what they care about, which is how the model decides what to say), and `public`.

```json
[
  { "id": "customer-support", "label": "Customer Support", "public": false,
    "description": "Support agents who will get questions about this: what changed, what customers may report, edge cases, how to explain it." },
  { "id": "sales", "label": "Sales", "public": false,
    "description": "Reps talking to prospects: what is new in terms of value and who it matters to, as long as the sources state it." },
  { "id": "customers", "label": "Customers", "public": true,
    "description": "People who use the product. Plain language, no internal detail." }
]
```

- **Internal** (`public: false`, the default): Support, Sales, Success, Solutions Engineering, Marketing, anyone. Their notes appear in the review draft with their own section and are **never** served by the feed or widget. This is enforced in code, not just in config.
- **Public** (`public: true`): end users. Only their approved, sourced entries can appear in the in-product feed.
- Add or remove teams freely. Each audience costs one extra entry per change in the model call. Changes users won't notice (infrastructure, refactors) are written only for internal audiences.

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

Edit `product.json` with your product's name, summary and areas, and `audiences.json` with your teams. Areas are the buckets changes are grouped into; `PRODUCT_SITE_URLS` adds text from your website.

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

Each release becomes a page with Release date, Version, links to the Slack messages and Jira tickets, and one section per audience (for example **Customer Support (internal)**, **Sales (internal)**, **Customer Success (internal)** and **For Customers**). Reviewers edit the page and set **Status** to Approved. `npm run digest -- --sync` (or the **Sync** button, or `RUN_EVERY_MINUTES`) reads the edits back. Entries that still have a "Needs review" callout are left out; deleting the callout signs one off.

## In-product release notes

One file, no dependencies, works in any page or framework. Use the pinned URL in production.

```html
<script src="https://YOUR-HOST/widget.v1.js" defer></script>
<release-notes-widget audience="customers" api="https://YOUR-HOST"></release-notes-widget>
```

Or let the script place a floating button for you: `<script src=".../widget.v1.js" data-audience="customers" defer></script>` (add `data-target="#slot"` to mount it in your own markup instead).

| Attribute | Meaning |
| --- | --- |
| `audience` | The `id` of a **public** audience from `audiences.json` (for example `customers`, or a separate `enterprise-admins` if you define one). Required unless `feed` is set |
| `api` | Origin of this app (default: the script's origin) |
| `feed` | Full URL of a static feed JSON. Skips the app entirely |
| `heading`, `theme`, `floating` | Heading text, `auto`/`light`/`dark`, fixed bottom-right button |

**Theming:** set `--rn-font`, `--rn-accent`, `--rn-fg`, `--rn-muted`, `--rn-bg`, `--rn-tint`, `--rn-line`, `--rn-radius` on the element or any ancestor. **Text:** set `el.strings = { heading, loading, empty, error, newUpdates, close, kinds }` to translate or reword. **Events:** `rn-open`, `rn-close`, `rn-loaded`, `rn-error` (bubble, composed).

**Accessibility:** the toggle is a real button with `aria-expanded`/`aria-controls`; focus moves to the heading on open and returns to the button on Escape or Close; clicking elsewhere closes without stealing focus; unread state is in the button's accessible name, not only a dot; loading, empty and error states are announced; releases are lists with `time` elements; the close target is 44px; focus rings are visible; forced-colors mode is handled; dark mode follows the OS or `theme`. Checked with axe (WCAG 2.0/2.1 A and AA) in Chromium in light and dark, including contrast.

**Running without the server (static feed):** set `FEED_DIR=public-feed`. Whenever a run, sync or approval happens the app rewrites one file per public audience there, such as `whats-new-customers.json`. Internal audiences never get a file. Upload the folder to any static host or CDN and point the widget at it with `feed="https://cdn.example.com/whats-new-customers.json"`. The widget then works with the app switched off. Serve the JSON with `Access-Control-Allow-Origin` for your product's origin.

Or call `GET /api/whats-new?audience=<public audience id>` and render it yourself. Requesting an internal audience returns 400. Only approved, sourced entries are ever returned. Set `WIDGET_ALLOWED_ORIGIN` to your product's origin in production.

## Deploying

It is a single Node 22 process with a JSON-file store. Set `ADMIN_TOKEN` so the review screen and run/approve routes are protected (the `/api/whats-new` feed stays public by design). Use a persistent disk for `STORE_PATH`, or replace `src/store.ts` with a database.

## Not built yet

- Confluence, Notion and Google Docs as *evidence* providers (they need per-source credentials)
- Slack threads (replies under an announcement are not read)
- Live tests against real Slack, Notion, Jira and Google accounts: adapters are covered with fakes only
- Screen reader testing with real assistive tech (VoiceOver, NVDA); only automated checks and a keyboard run so far

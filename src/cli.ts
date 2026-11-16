import { parseArgs } from "node:util";
import { runDigest, syncReviews, writeFeeds } from "./app.js";
import { loadConfig } from "./config.js";
import { ClaudeLlm } from "./llm.js";
import { NotionPublisher } from "./adapters/publishers/notion.js";
import { JsonStore } from "./store.js";

// npm run digest                         -> read the last LOOKBACK_DAYS of messages and write drafts
// npm run digest -- --since 2026-11-01   -> backfill from a date
// npm run digest -- --sync               -> pull approvals/edits back from Notion
// npm run digest -- --setup-notion <parent page id>  -> create the Release notes database
const { values, positionals } = parseArgs({
  options: { since: { type: "string" }, until: { type: "string" }, sync: { type: "boolean" }, "setup-notion": { type: "boolean" } },
  allowPositionals: true,
});

if (values["setup-notion"]) {
  const token = process.env.NOTION_TOKEN;
  if (!token || !positionals[0]) throw new Error("Usage: NOTION_TOKEN=... npm run digest -- --setup-notion <parent page id>");
  const db = await NotionPublisher.createDatabase(token, positionals[0]);
  console.log(`Created ${db.url}\nSet NOTION_DATA_SOURCE_ID=${db.dataSourceId}`);
} else {
  const cfg = await loadConfig();
  const store = new JsonStore(cfg.storePath);
  if (values.sync) {
    console.log(`Updated ${await syncReviews(cfg, store)} drafts from ${cfg.publisher.name}`);
    if (cfg.feedDir) console.log("Wrote", await writeFeeds(store, cfg.feedDir, cfg.audiences));
  } else {
    const r = await runDigest(cfg, new ClaudeLlm(), store, {
      since: values.since ? new Date(values.since) : undefined,
      until: values.until ? new Date(values.until) : undefined,
    });
    console.log(JSON.stringify(r, null, 2));
  }
}

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { approveDraft, runDigest, syncReviews, whatsNew, writeFeeds } from "./app.js";
import { loadConfig } from "./config.js";
import { ClaudeLlm } from "./llm.js";
import { JsonStore } from "./store.js";
import { AUDIENCES, type Audience } from "./types.js";

const cfg = loadConfig();
const store = new JsonStore(cfg.storePath);
const llm = new ClaudeLlm();
const app = express();
app.use(express.json());

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const adminToken = process.env.ADMIN_TOKEN;

// Admin routes (run, review, approve) need ADMIN_TOKEN when it is set. The in-product feed is public.
const requireAdmin: express.RequestHandler = (req, res, next) => {
  if (!adminToken || req.get("authorization") === `Bearer ${adminToken}`) return next();
  res.status(401).json({ error: "Missing or wrong admin token" });
};

let running = false;
app.post("/api/run", requireAdmin, async (req, res) => {
  if (running) return void res.status(409).json({ error: "A run is already in progress" });
  running = true;
  try {
    const since = req.body?.since ? new Date(req.body.since) : undefined;
    const until = req.body?.until ? new Date(req.body.until) : undefined;
    const result = await runDigest(cfg, llm, store, { since, until });
    if (cfg.feedDir) await writeFeeds(store, cfg.feedDir);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    running = false;
  }
});

app.post("/api/sync", requireAdmin, async (_req, res) => {
  try {
    const updated = await syncReviews(cfg, store);
    if (cfg.feedDir) await writeFeeds(store, cfg.feedDir);
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/drafts", requireAdmin, async (_req, res) => {
  res.json({
    lastRunAt: await store.lastRunAt(),
    source: cfg.source.name,
    destination: cfg.publisher.name,
    providers: cfg.providers.map((p) => p.name),
    drafts: await store.drafts(),
  });
});

app.post("/api/drafts/:id/approve", requireAdmin, async (req, res) => {
  const d = await approveDraft(store, String(req.params.id));
  if (!d) return void res.status(404).json({ error: "Draft not found" });
  if (cfg.feedDir) await writeFeeds(store, cfg.feedDir);
  res.json(d);
});

// Public, read-only feed for the in-product "What's new" widget.
app.get("/api/whats-new", async (req, res) => {
  const audience = String(req.query.audience ?? "student") as Audience;
  if (!AUDIENCES.includes(audience) || audience === "internal") return void res.status(400).json({ error: "audience must be instructor or student" });
  res.set("Access-Control-Allow-Origin", process.env.WIDGET_ALLOWED_ORIGIN ?? "*");
  res.set("Cache-Control", "public, max-age=300");
  res.json({ audience, releases: await whatsNew(store, audience, Number(req.query.limit ?? 10)) });
});

// Pinned URL for production embeds. Breaking widget changes will ship as widget.v2.js, never over v1.
app.get("/widget.v1.js", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.set("Access-Control-Allow-Origin", "*");
  res.sendFile(join(publicDir, "widget.js"));
});
app.use(express.static(publicDir, { setHeaders: (res) => res.set("Access-Control-Allow-Origin", "*") }));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Release notes agent on http://localhost:${port}`));

// Optional schedule: run the digest and sync reviews every N minutes.
const every = Number(process.env.RUN_EVERY_MINUTES ?? 0);
if (every > 0) {
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await runDigest(cfg, llm, store);
      await syncReviews(cfg, store);
      if (cfg.feedDir) await writeFeeds(store, cfg.feedDir);
      console.log(`Scheduled run: ${r.announcements} announcements, ${r.drafts.length} drafts`, r.errors);
    } catch (err) {
      console.error("Scheduled run failed", err);
    } finally {
      running = false;
    }
  }, every * 60_000);
}

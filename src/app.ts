import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "./config.js";
import type { Llm } from "./llm.js";
import { buildDraft } from "./pipeline/compose.js";
import { detectChanges, groupIntoBatches } from "./pipeline/detect.js";
import type { JsonStore } from "./store.js";
import type { Audience, AudienceDef, ReleaseDraft } from "./types.js";

export interface RunResult {
  messagesRead: number;
  announcements: number;
  drafts: { id: string; title: string; url?: string; items: number; needsReview: number }[];
  errors: string[];
}

/**
 * The whole flow: chat source -> detect deployments -> retrieve linked context ->
 * compose per-audience notes (with the sourcing rule enforced) -> publish drafts.
 */
export async function runDigest(cfg: AppConfig, llm: Llm, store: JsonStore, range?: { since?: Date; until?: Date }): Promise<RunResult> {
  const until = range?.until ?? new Date();
  const since = range?.since ?? new Date(until.getTime() - cfg.lookbackDays * 86_400_000);
  const errors: string[] = [];

  const processed = await store.processed();
  const messages = (await cfg.source.fetchMessages({ since, until })).filter((m) => !processed.has(m.id));
  const detected = await detectChanges(llm, messages);
  const batches = groupIntoBatches(detected, cfg.grouping, cfg.timeZone);
  const product = await cfg.product.load();

  const result: RunResult = { messagesRead: messages.length, announcements: detected.length, drafts: [], errors };
  const done: string[] = messages.filter((m) => !detected.some((d) => d.message.id === m.id)).map((m) => m.id);

  for (const batch of batches) {
    const draft = await buildDraft({ llm, batch, providers: cfg.providers, product, audiences: cfg.audiences });
    // A second run on the same day/version extends the earlier draft instead of creating another.
    const existing = await store.draft(draft.id);
    if (existing && existing.status !== "draft") {
      draft.id = `${draft.id}_${Date.now().toString(36)}`;
    }
    try {
      draft.destination = { name: cfg.publisher.name, ...(await cfg.publisher.publish(draft)) };
    } catch (err) {
      errors.push(`Publishing "${draft.title}" to ${cfg.publisher.name} failed: ${(err as Error).message}`);
    }
    await store.upsertDraft(draft);
    if (draft.destination) done.push(...batch.messages.map((m) => m.id));
    result.drafts.push({
      id: draft.id,
      title: draft.title,
      url: draft.destination?.url,
      items: draft.items.length,
      needsReview: draft.items.filter((i) => i.status === "needs_review").length,
    });
  }
  await store.markProcessed(done);
  return result;
}

/** Pull review status (and reviewer edits) back from the destination, e.g. Notion. */
export async function syncReviews(cfg: AppConfig, store: JsonStore): Promise<number> {
  if (!cfg.publisher.readReview) return 0;
  let changed = 0;
  for (const draft of await store.drafts()) {
    if (draft.status === "published" || draft.destination?.name !== cfg.publisher.name) continue;
    const review = await cfg.publisher.readReview(draft);
    if (!review || review.status === "draft") continue;
    await store.upsertDraft({
      ...draft,
      status: review.status,
      items: review.items ?? draft.items,
      approvedAt: draft.approvedAt ?? new Date().toISOString(),
    });
    changed++;
  }
  return changed;
}

/** Approve from the review screen (for destinations without a status field). Drops unreviewed entries. */
export async function approveDraft(store: JsonStore, id: string): Promise<ReleaseDraft | undefined> {
  const draft = await store.draft(id);
  if (!draft) return undefined;
  const approved = { ...draft, status: "approved" as const, approvedAt: new Date().toISOString() };
  await store.upsertDraft(approved);
  return approved;
}

export interface WhatsNewEntry {
  releaseId: string;
  date: string;
  version?: string;
  items: { title: string; body: string; kind: string; area: string }[];
}

/** Approved, source-backed notes for one public audience. Needs-review entries and internal audiences never reach users. */
export async function whatsNew(store: JsonStore, audience: Audience, limit = 10): Promise<WhatsNewEntry[]> {
  return (await store.drafts())
    .filter((d) => d.status === "approved" || d.status === "published")
    // Only audiences marked public in the draft's own snapshot can ever be served. This is the guard that
    // keeps internal team notes (support, sales, success) out of the product, whatever is requested.
    .filter((d) => d.audiences.some((a) => a.id === audience && a.public))
    .map((d) => ({
      releaseId: d.id,
      date: d.batch.date,
      version: d.batch.version,
      items: d.items
        .filter((i) => i.audience === audience && i.status === "supported")
        .map(({ title, body, kind, area }) => ({ title, body, kind, area })),
    }))
    .filter((e) => e.items.length > 0)
    .slice(0, limit);
}

/**
 * Writes the in-product feed as one static file per public audience (whats-new-<audience>.json) so the
 * widget can read them from a CDN or any static host with no server running. Same shape as /api/whats-new.
 */
export async function writeFeeds(store: JsonStore, dir: string, audiences: AudienceDef[], limit = 10): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const { id: audience } of audiences.filter((a) => a.public)) {
    const file = join(dir, `whats-new-${audience}.json`);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ audience, releases: await whatsNew(store, audience, limit) }, null, 2));
    await rename(tmp, file);
    written.push(file);
  }
  return written;
}

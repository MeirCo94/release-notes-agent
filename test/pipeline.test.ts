import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveDraft, runDigest, whatsNew } from "../src/app.js";
import { FileSource } from "../src/adapters/sources/file.js";
import { MarkdownPublisher } from "../src/adapters/publishers/markdown.js";
import type { AppConfig } from "../src/config.js";
import { groupIntoBatches } from "../src/pipeline/detect.js";
import { JsonStore } from "../src/store.js";
import { BrokenProvider, FakeJira, FakeLlm, msg, product } from "./helpers.js";

// Scripted detection for fixtures/deploy-announcements.json
const llm = new FakeLlm((messages) => ({
  messages: messages.map((m) => {
    if (m.id === "sample:1") return { messageId: m.id, isDeployAnnouncement: true, version: "3.42.0", changes: [
      { summary: "Instructors can import a rubric from another course", kind: "feature", jiraKeys: ["KRT-1201"], prUrls: ["https://github.com/example-org/example-app/pull/481"], docUrls: [] },
      { summary: "Evaluation timer no longer resets when switching tabs", kind: "fix", jiraKeys: ["KRT-1188"], prUrls: [], docUrls: [] },
      { summary: "Node upgraded on workers", kind: "internal", jiraKeys: [], prUrls: [], docUrls: [] },
    ] };
    if (m.id === "sample:3") return { messageId: m.id, isDeployAnnouncement: true, version: null, changes: [
      { summary: "Safari students can submit again", kind: "fix", jiraKeys: ["KRT-1215"], prUrls: [], docUrls: [] },
    ] };
    if (m.id === "sample:4") return { messageId: m.id, isDeployAnnouncement: true, version: null, changes: [
      { summary: "New AI usage summary on the authorship report", kind: "feature", jiraKeys: [], prUrls: [], docUrls: [] },
    ] };
    return { messageId: m.id, isDeployAnnouncement: false, version: null, changes: [] };
  }),
}));

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "rna-"));
  const cfg: AppConfig = {
    source: new FileSource("fixtures/deploy-announcements.json"),
    providers: [new FakeJira({ "KRT-1201": "Import rubric from another course.", "KRT-1188": "Timer bug." }), new BrokenProvider()],
    publisher: new MarkdownPublisher(join(dir, "out")),
    product: { load: async () => product },
    grouping: "release",
    timeZone: "UTC",
    audiences: ["instructor", "student", "internal"],
    lookbackDays: 30,
    storePath: join(dir, "store.json"),
  };
  return { cfg, store: new JsonStore(cfg.storePath) };
}
const range = { since: new Date("2026-11-01T00:00:00Z"), until: new Date("2026-11-15T00:00:00Z") };

describe("runDigest end to end", () => {
  it("creates one draft per release/day, flags unsupported changes, and skips chatter", async () => {
    const { cfg, store } = await setup();
    const r = await runDigest(cfg, llm, store, range);
    expect(r.messagesRead).toBe(4);
    expect(r.announcements).toBe(3);
    expect(r.drafts.map((d) => d.title)).toEqual(["Release 3.42.0 (2026-11-10)", "Product updates, 2026-11-12"]);

    const [nov12, v342] = await store.drafts();
    expect(v342.items.filter((i) => i.status === "supported")).toHaveLength(6); // 2 sourced changes x 3 audiences
    expect(v342.items.filter((i) => i.kind === "internal").map((i) => i.audience)).toEqual(["internal"]);
    // KRT-1215 isn't in Jira, and there's no ticket for the AI summary: nothing is explained.
    expect(nov12.items.every((i) => i.status === "needs_review")).toBe(true);

    const md = await readFile(v342.destination!.id, "utf8");
    expect(md).toContain("**Release date:** 2026-11-10");
    expect(md).toContain("**Version:** 3.42.0");
    expect(md).toContain("https://example.slack.com/archives/C000DEPLOYS/p1762786920000100");
    expect(md).toContain("[KRT-1201](https://jira.example/browse/KRT-1201)");
    expect(md).toContain("## For instructors");
  });

  it("does not reprocess messages on a second run", async () => {
    const { cfg, store } = await setup();
    await runDigest(cfg, llm, store, range);
    const again = await runDigest(cfg, llm, store, range);
    expect(again.messagesRead).toBe(0);
    expect(again.drafts).toHaveLength(0);
  });

  it("only exposes approved, sourced entries in the in-product feed, per audience", async () => {
    const { cfg, store } = await setup();
    await runDigest(cfg, llm, store, range);
    expect(await whatsNew(store, "student")).toEqual([]);
    for (const d of await store.drafts()) await approveDraft(store, d.id);
    const feed = await whatsNew(store, "student");
    expect(feed).toHaveLength(1); // the Nov 12 draft has nothing sourced, so it isn't shown
    expect(feed[0].version).toBe("3.42.0");
    expect(feed[0].items.map((i) => i.kind).sort()).toEqual(["feature", "fix"]);
  });
});

describe("groupIntoBatches", () => {
  const d = (id: string, at: string, version?: string) => ({ message: msg(id, "x", at), version, changes: [] });
  it("groups by version, then by day for unversioned messages", () => {
    const b = groupIntoBatches([d("a", "2026-11-10T10:00:00Z", "1.2"), d("b", "2026-11-11T10:00:00Z", "1.2"), d("c", "2026-11-11T12:00:00Z")], "release");
    expect(b.map((x) => [x.version, x.date, x.messages.length])).toEqual([["1.2", "2026-11-10", 2], [undefined, "2026-11-11", 1]]);
  });
  it("uses the configured time zone for day boundaries", () => {
    const b = groupIntoBatches([d("a", "2026-11-11T03:00:00Z")], "day", "America/Toronto");
    expect(b[0].date).toBe("2026-11-10");
  });
});

import { describe, expect, it } from "vitest";
import { composeChange } from "../src/pipeline/compose.js";
import type { DetectedChange } from "../src/types.js";
import { FakeLlm, msg, product } from "./helpers.js";

const change = (over: Partial<DetectedChange> = {}): DetectedChange => ({
  id: "chg_1", messageId: "m1", summary: "Shipped the AI usage summary", kind: "feature",
  jiraKeys: [], prUrls: [], docUrls: [], ...over,
});
const evidence = [{ id: "jira:KRT-1", type: "jira" as const, title: "KRT-1", url: "https://j/KRT-1", text: "Why and how" }];
const base = { message: msg("m1", "Shipped the AI usage summary"), product, audiences: ["instructor", "student"] as const, gaps: [] };

describe("sourcing rule", () => {
  it("does not call the model and marks every entry needs_review when there is no evidence", async () => {
    const llm = new FakeLlm(() => ({ messages: [] }));
    const items = await composeChange({ ...base, audiences: [...base.audiences], llm, change: change(), evidence: [] });
    expect(llm.composeCalls).toBe(0);
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i.status).toBe("needs_review");
      expect(i.citations).toEqual([]);
      expect(i.body).toBe('From the deploy announcement: "Shipped the AI usage summary"');
      expect(i.reviewReason).toMatch(/No Jira ticket/);
    }
  });

  it("says the sources couldn't be read when links exist but nothing came back", async () => {
    const llm = new FakeLlm(() => ({ messages: [] }));
    const items = await composeChange({
      ...base, audiences: [...base.audiences], llm, change: change({ jiraKeys: ["KRT-9"] }), evidence: [],
      gaps: ["jira could not be reached: 401"],
    });
    expect(items[0].reviewReason).toMatch(/could not be read.*401/);
  });

  it("downgrades entries that cite sources that were never provided", async () => {
    const llm = new FakeLlm(() => ({ messages: [] }), () => ({
      area: "Peer evaluation",
      entries: [
        { audience: "instructor", relevant: true, title: "T", body: "Invented", citations: ["jira:KRT-404"], supported: true, reviewReason: null },
        { audience: "student", relevant: true, title: "T", body: "Fine", citations: ["jira:KRT-1"], supported: true, reviewReason: null },
      ],
    }));
    const items = await composeChange({ ...base, audiences: [...base.audiences], llm, change: change({ jiraKeys: ["KRT-1"] }), evidence });
    const byAud = Object.fromEntries(items.map((i) => [i.audience, i]));
    expect(byAud.instructor.status).toBe("needs_review");
    expect(byAud.instructor.body).not.toContain("Invented");
    expect(byAud.instructor.reviewReason).toMatch(/KRT-404/);
    expect(byAud.student.status).toBe("supported");
  });

  it("downgrades entries the model itself flags as unsupported, or that cite nothing", async () => {
    const llm = new FakeLlm(() => ({ messages: [] }), () => ({
      area: "Nonexistent area",
      entries: [
        { audience: "instructor", relevant: true, title: "T", body: "B", citations: ["jira:KRT-1"], supported: false, reviewReason: "Ticket has no description" },
        { audience: "student", relevant: true, title: "T", body: "B", citations: [], supported: true, reviewReason: null },
      ],
    }));
    const items = await composeChange({ ...base, audiences: [...base.audiences], llm, change: change({ jiraKeys: ["KRT-1"] }), evidence });
    expect(items.map((i) => i.status)).toEqual(["needs_review", "needs_review"]);
    expect(items[0].reviewReason).toBe("Ticket has no description");
    expect(items[0].area).toBe("Other");
  });

  it("only writes internal changes for the internal audience", async () => {
    const llm = new FakeLlm(() => ({ messages: [] }));
    const items = await composeChange({ ...base, audiences: ["instructor", "student", "internal"], llm, change: change({ kind: "internal" }), evidence: [] });
    expect(items.map((i) => i.audience)).toEqual(["internal"]);
  });
});

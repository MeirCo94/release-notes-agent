import { describe, expect, it } from "vitest";
import { NotionPublisher } from "../src/adapters/publishers/notion.js";
import type { ReleaseDraft } from "../src/types.js";

const draft: ReleaseDraft = {
  id: "draft_1", title: "Release 3.42.0 (2026-11-10)", status: "draft", createdAt: "2026-11-10T00:00:00Z",
  batch: { id: "rel_1", date: "2026-11-10", version: "3.42.0", messages: [{ id: "m1", channel: "c", author: "a", postedAt: "2026-11-10T15:00:00Z", text: "x", permalink: "https://slack.example/m1" }],
    changes: [{ id: "c1", messageId: "m1", summary: "s", kind: "feature", jiraKeys: ["KRT-1"], prUrls: [], docUrls: [] }] },
  evidence: [{ id: "jira:KRT-1", type: "jira", title: "KRT-1: Import rubric", url: "https://jira.example/browse/KRT-1", text: "t" }],
  items: [
    { changeId: "c1", audience: "student", kind: "feature", area: "Activity creation", title: "Rubric import", body: "Original body", citations: ["jira:KRT-1"], status: "supported" },
    { changeId: "c2", audience: "student", kind: "fix", area: "Other", title: "Timer fix", body: "restated", citations: [], status: "needs_review", reviewReason: "No source" },
    { changeId: "c3", audience: "student", kind: "fix", area: "Other", title: "Signed off fix", body: "restated", citations: [], status: "needs_review", reviewReason: "No source" },
  ],
};

function fakeClient(created: any[], pageStatus: string, blocks: (b: any[]) => any[]) {
  return {
    pages: {
      create: async (args: any) => { created.push(args); return { id: "page1", url: "https://notion.so/page1" }; },
      retrieve: async () => ({ properties: { Status: { select: { name: pageStatus } } } }),
    },
    blocks: { children: { append: async () => ({}), list: async () => ({ results: blocks(created[0].children), has_more: false }) } },
  } as any;
}

describe("NotionPublisher", () => {
  it("creates a Draft page with metadata properties and labelled sections", async () => {
    const created: any[] = [];
    const pub = new NotionPublisher({ token: "t", dataSourceId: "ds1" }, fakeClient(created, "Draft", (b) => b));
    const res = await pub.publish(draft);
    expect(res.url).toBe("https://notion.so/page1");
    const p = created[0];
    expect(p.parent).toEqual({ type: "data_source_id", data_source_id: "ds1" });
    expect(p.properties.Status.select.name).toBe("Draft");
    expect(p.properties["Release date"].date.start).toBe("2026-11-10");
    expect(p.properties["Needs review"].number).toBe(2);
    expect(p.properties["Jira tickets"].rich_text[0].text.content).toBe("KRT-1");
    const headings = p.children.filter((b: any) => b.type === "heading_2").map((b: any) => b.heading_2.rich_text[0].text.content);
    expect(headings).toContain("For students");
    expect(JSON.stringify(p.children)).toContain("https://slack.example/m1");
  });

  it("reads approved edits back and drops entries that are still flagged", async () => {
    const created: any[] = [];
    const pub = new NotionPublisher({ token: "t", dataSourceId: "ds1" });
    // Reviewer edited the first body and deleted the callout on "Signed off fix".
    const edited = (blocks: any[]) => {
      const out = blocks.map((b) => JSON.parse(JSON.stringify(b)));
      const i = out.findIndex((b) => b.type === "heading_3" && b.heading_3.rich_text[0].text.content === "Rubric import");
      out[i + 2].paragraph.rich_text[0].text.content = "Edited by a human";
      const j = out.findIndex((b) => b.type === "heading_3" && b.heading_3.rich_text[0].text.content === "Signed off fix");
      out.splice(j + 2, 1); // remove the Needs review callout
      return out.map((b) => ({ ...b, [b.type]: { ...b[b.type], rich_text: (b[b.type].rich_text ?? []).map((r: any) => ({ ...r, plain_text: r.text.content })) } }));
    };
    (pub as any).client = fakeClient(created, "Approved", edited);
    created.push({ children: (new NotionPublisher({ token: "t", dataSourceId: "x" }) as any).toBlocks(draft) });
    const review = await pub.readReview({ ...draft, destination: { name: "notion", id: "page1", url: "u" } });
    expect(review?.status).toBe("approved");
    const titles = review!.items!.map((i) => i.title);
    expect(titles).toEqual(["Rubric import", "Signed off fix"]); // "Timer fix" still flagged -> excluded
    expect(review!.items![0].body).toBe("Edited by a human");
    expect(review!.items![0].citations).toEqual(["jira:KRT-1"]);
    expect(review!.items!.every((i) => i.status === "supported")).toBe(true);
  });
});

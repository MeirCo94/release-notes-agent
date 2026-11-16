import notionSdk from "@notionhq/client";
import type { Client as NotionClient } from "@notionhq/client";

// The SDK is CommonJS, so under ESM the Client class is only reachable through the default export.
const { Client } = notionSdk;
import type { Audience, NoteItem, ReleaseDraft } from "../../types.js";
import type { DraftPublisher, ReviewedDraft } from "../types.js";
import { audienceHeading, buildOutline, NEEDS_REVIEW } from "./render.js";

// Notion pages are created in a "Release notes" database with a Status select:
// Draft -> In review -> Approved -> Published. Reviewers edit the page in Notion; when Status is
// Approved or Published the app reads the audience sections back and serves them in-product.

export const STATUS = { draft: "Draft", review: "In review", approved: "Approved", published: "Published" } as const;

type Block = Record<string, any>;
const text = (content: string, opts: { link?: string; bold?: boolean; italic?: boolean; color?: string } = {}) =>
  // Notion caps one rich-text object at 2000 characters.
  content.match(/[\s\S]{1,2000}/g)?.map((chunk) => ({
    type: "text",
    text: { content: chunk, link: opts.link ? { url: opts.link } : null },
    annotations: { bold: !!opts.bold, italic: !!opts.italic, color: opts.color ?? "default" },
  })) ?? [];
const para = (rich: any[]): Block => ({ type: "paragraph", paragraph: { rich_text: rich } });
const heading = (level: 1 | 2 | 3, s: string): Block => ({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: text(s) } });
const callout = (s: string, emoji: string, color: string): Block => ({
  type: "callout",
  callout: { rich_text: text(s), icon: { type: "emoji", emoji }, color },
});
const bullet = (rich: any[]): Block => ({ type: "bulleted_list_item", bulleted_list_item: { rich_text: rich } });

export class NotionPublisher implements DraftPublisher {
  readonly name = "notion";
  private client: NotionClient;
  constructor(private opts: { token: string; dataSourceId: string }, client?: NotionClient) {
    this.client = client ?? new Client({ auth: opts.token });
  }

  /** Creates the "Release notes" database under a parent page. Returns its data source id. */
  static async createDatabase(token: string, parentPageId: string): Promise<{ dataSourceId: string; url: string }> {
    const client = new Client({ auth: token });
    const db: any = await client.databases.create({
      parent: { type: "page_id", page_id: parentPageId },
      title: text("Release notes") as any,
      initial_data_source: {
        properties: {
          Name: { title: {} },
          Status: {
            select: {
              options: [
                { name: STATUS.draft, color: "gray" },
                { name: STATUS.review, color: "yellow" },
                { name: STATUS.approved, color: "blue" },
                { name: STATUS.published, color: "green" },
              ],
            },
          },
          "Release date": { date: {} },
          Version: { rich_text: {} },
          "Needs review": { number: {} },
          "Jira tickets": { rich_text: {} },
          "Draft ID": { rich_text: {} },
        },
      } as any,
    });
    return { dataSourceId: db.data_sources?.[0]?.id, url: db.url };
  }

  toBlocks(draft: ReleaseDraft): Block[] {
    const o = buildOutline(draft);
    const blocks: Block[] = [];
    for (const m of o.metadata) {
      const rich = [...text(`${m.label}: `, { bold: true }), ...text(m.value)];
      blocks.push(bullet(rich));
      for (const l of m.links ?? []) blocks.push(bullet(text(l.label, { link: l.url })));
    }
    blocks.push(callout(o.reviewSummary, "📝", "yellow_background"));
    for (const s of o.sections) {
      blocks.push(heading(2, s.heading));
      for (const { item, meta, sources } of s.items) {
        blocks.push(heading(3, item.title));
        blocks.push(para(text(meta, { italic: true, color: "gray" })));
        if (item.status === "needs_review") blocks.push(callout(`${NEEDS_REVIEW}: ${item.reviewReason ?? ""}`, "⚠️", "orange_background"));
        for (const p of item.body.split(/\n{2,}/)) blocks.push(para(text(p)));
        if (sources.length)
          blocks.push(
            para([
              ...text("Sources: ", { color: "gray" }),
              ...sources.flatMap((x, i) => [...(i ? text(", ", { color: "gray" }) : []), ...text(x.label, { link: x.url, color: "gray" })]),
            ]),
          );
      }
    }
    if (o.evidence.length) {
      blocks.push({ type: "divider", divider: {} }, heading(2, "Sources consulted"));
      for (const e of o.evidence) blocks.push(bullet(text(e.title, { link: e.url })));
    }
    return blocks;
  }

  async publish(draft: ReleaseDraft) {
    const blocks = this.toBlocks(draft);
    const flagged = draft.items.filter((i) => i.status === "needs_review").length;
    const jira = [...new Set(draft.batch.changes.flatMap((c) => c.jiraKeys))].join(", ");
    const page: any = await this.client.pages.create({
      parent: { type: "data_source_id", data_source_id: this.opts.dataSourceId },
      icon: { type: "emoji", emoji: "🚀" },
      properties: {
        Name: { title: text(draft.title) },
        Status: { select: { name: STATUS.draft } },
        "Release date": { date: { start: draft.batch.date } },
        Version: { rich_text: text(draft.batch.version ?? "") },
        "Needs review": { number: flagged },
        "Jira tickets": { rich_text: text(jira) },
        "Draft ID": { rich_text: text(draft.id) },
      } as any,
      children: blocks.slice(0, 100) as any,
    });
    // Notion accepts at most 100 child blocks per request.
    for (let i = 100; i < blocks.length; i += 100) {
      await this.client.blocks.children.append({ block_id: page.id, children: blocks.slice(i, i + 100) as any });
    }
    return { id: page.id as string, url: page.url as string };
  }

  /**
   * Reads Status and the edited audience sections back from the page. Entries that still carry a
   * "Needs review" callout are dropped: deleting the callout is how a reviewer signs one off.
   */
  async readReview(draft: ReleaseDraft): Promise<ReviewedDraft | null> {
    const id = draft.destination?.id;
    if (!id) return null;
    const page: any = await this.client.pages.retrieve({ page_id: id });
    const statusName: string | undefined = page.properties?.Status?.select?.name;
    const status =
      statusName === STATUS.published ? "published" : statusName === STATUS.approved ? "approved" : "draft";
    if (status === "draft") return { status };

    const blocks: any[] = [];
    let cursor: string | undefined;
    do {
      const res: any = await this.client.blocks.children.list({ block_id: id, start_cursor: cursor, page_size: 100 });
      blocks.push(...res.results);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    const plain = (b: any) => (b[b.type]?.rich_text ?? []).map((r: any) => r.plain_text).join("");
    const audienceByHeading = new Map(draft.audiences.map((a) => [audienceHeading(a), a.id]));
    const original = new Map(draft.items.map((i) => [`${i.audience}:${i.title}`, i]));

    const items: NoteItem[] = [];
    let audience: Audience | undefined;
    let current: (NoteItem & { flagged: boolean; paras: string[] }) | undefined;
    const flush = () => {
      if (current && !current.flagged && current.paras.length) {
        const { flagged: _f, paras, ...rest } = current;
        items.push({ ...rest, body: paras.join("\n\n"), status: "supported", reviewReason: undefined });
      }
      current = undefined;
    };

    for (const b of blocks) {
      if (b.type === "heading_2") {
        flush();
        audience = audienceByHeading.get(plain(b));
      } else if (b.type === "heading_3" && audience) {
        flush();
        const title = plain(b);
        const before = original.get(`${audience}:${title}`);
        current = {
          changeId: before?.changeId ?? `edited_${items.length}`,
          audience,
          kind: before?.kind ?? "improvement",
          area: before?.area ?? "Other",
          title,
          body: "",
          citations: before?.citations ?? [],
          status: "supported",
          flagged: false,
          paras: [],
        };
      } else if (current && b.type === "callout" && plain(b).startsWith(NEEDS_REVIEW)) {
        current.flagged = true;
      } else if (current && b.type === "paragraph") {
        const t = plain(b).trim();
        const isMeta = b.paragraph.rich_text?.[0]?.annotations?.italic && t.includes(" · ");
        if (t && !isMeta && !t.startsWith("Sources:")) current.paras.push(t);
      } else if (b.type === "divider") {
        flush();
        audience = undefined;
      }
    }
    flush();
    return { status, items };
  }
}

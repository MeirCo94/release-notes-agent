import type { ChatMessage } from "../../types.js";
import type { ChatSource } from "../types.js";
import { normaliseSlackLinks } from "../../pipeline/refs.js";

/**
 * Reads a Slack channel with a bot token (scopes: channels:history, groups:history for private
 * channels). Invite the bot to the channel first.
 */
export class SlackSource implements ChatSource {
  readonly name = "slack";
  constructor(
    private opts: { token: string; channelId: string; workspaceUrl?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, params: Record<string, string>) {
    const url = `https://slack.com/api/${method}?${new URLSearchParams(params)}`;
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.opts.token}` } });
    const body = (await res.json()) as any;
    if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error}`);
    return body;
  }

  async fetchMessages({ since, until }: { since: Date; until: Date }): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    let cursor: string | undefined;
    do {
      const body = await this.call("conversations.history", {
        channel: this.opts.channelId,
        oldest: String(since.getTime() / 1000),
        latest: String(until.getTime() / 1000),
        limit: "200",
        ...(cursor ? { cursor } : {}),
      });
      for (const m of body.messages as any[]) {
        if (m.subtype && m.subtype !== "bot_message" && m.subtype !== "thread_broadcast") continue;
        const text = normaliseSlackLinks([m.text, ...(m.attachments ?? []).map((a: any) => a.text ?? "")].join("\n").trim());
        if (!text) continue;
        out.push({
          id: `slack:${this.opts.channelId}:${m.ts}`,
          channel: this.opts.channelId,
          author: m.user ?? m.username ?? m.bot_id ?? "unknown",
          postedAt: new Date(Number(m.ts) * 1000).toISOString(),
          text,
          permalink: this.opts.workspaceUrl
            ? `${this.opts.workspaceUrl.replace(/\/$/, "")}/archives/${this.opts.channelId}/p${m.ts.replace(".", "")}`
            : undefined,
        });
      }
      cursor = body.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return out.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  }
}

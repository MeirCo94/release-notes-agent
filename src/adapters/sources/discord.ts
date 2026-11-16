import type { ChatMessage } from "../../types.js";
import type { ChatSource } from "../types.js";

/** Reads a Discord channel with a bot token (needs Read Message History + Message Content intent). */
export class DiscordSource implements ChatSource {
  readonly name = "discord";
  constructor(
    private opts: { token: string; channelId: string; guildId?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchMessages({ since, until }: { since: Date; until: Date }): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    let before: string | undefined;
    for (;;) {
      const qs = new URLSearchParams({ limit: "100", ...(before ? { before } : {}) });
      const res = await this.fetchImpl(`https://discord.com/api/v10/channels/${this.opts.channelId}/messages?${qs}`, {
        headers: { Authorization: `Bot ${this.opts.token}` },
      });
      if (!res.ok) throw new Error(`Discord returned ${res.status}`);
      const page = (await res.json()) as any[];
      if (page.length === 0) break;
      let reachedStart = false;
      for (const m of page) {
        const at = new Date(m.timestamp);
        if (at < since) { reachedStart = true; continue; }
        if (at > until || !m.content) continue;
        out.push({
          id: `discord:${this.opts.channelId}:${m.id}`,
          channel: this.opts.channelId,
          author: m.author?.username ?? "unknown",
          postedAt: at.toISOString(),
          text: [m.content, ...(m.embeds ?? []).map((e: any) => [e.title, e.description, e.url].filter(Boolean).join("\n"))].join("\n"),
          permalink: this.opts.guildId
            ? `https://discord.com/channels/${this.opts.guildId}/${this.opts.channelId}/${m.id}`
            : undefined,
        });
      }
      if (reachedStart) break;
      before = page[page.length - 1].id;
    }
    return out.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  }
}

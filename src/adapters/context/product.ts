import { readFile } from "node:fs/promises";
import type { ProductContext } from "../../types.js";
import type { ProductContextSource } from "../types.js";
import { htmlToText } from "./html.js";

/**
 * Product context = a small, human-maintained JSON file (name, summary, product areas) plus
 * optional text pulled from the public website. The areas drive grouping; the website text helps
 * the model use the product's own language.
 */
export class WebsiteProductContext implements ProductContextSource {
  private cached?: ProductContext;
  constructor(private opts: { configPath: string; urls: string[] }, private fetchImpl: typeof fetch = fetch) {}

  async load(): Promise<ProductContext> {
    if (this.cached) return this.cached;
    const base = JSON.parse(await readFile(this.opts.configPath, "utf8")) as ProductContext;
    const pages: string[] = [];
    for (const url of this.opts.urls) {
      try {
        const res = await this.fetchImpl(url, { headers: { "User-Agent": "release-notes-agent" } });
        if (res.ok) pages.push(htmlToText(await res.text()).slice(0, 6000));
      } catch {
        // Website is optional context; the config file alone is enough to run.
      }
    }
    this.cached = {
      ...base,
      summary: pages.length ? `${base.summary}\n\nFrom the product website:\n${pages.join("\n---\n")}` : base.summary,
      sources: [...(base.sources ?? []), ...this.opts.urls],
    };
    return this.cached;
  }
}

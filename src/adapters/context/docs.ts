import type { DetectedChange, Evidence } from "../../types.js";
import type { ContextProvider } from "../types.js";
import { htmlTitle, htmlToText } from "./html.js";

/**
 * Public docs, help-centre articles and design docs linked in the announcement. Only fetches
 * hosts on the allowlist so a pasted link can't make the server request arbitrary URLs.
 * Private sources (Notion, Confluence, Google Docs) need their own provider with credentials.
 */
export class LinkedDocsProvider implements ContextProvider {
  readonly name = "docs";
  constructor(private opts: { allowedHosts: string[] }, private fetchImpl: typeof fetch = fetch) {}

  private allowed(url: string) {
    try {
      const host = new URL(url).hostname;
      return this.opts.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    } catch {
      return false;
    }
  }

  async resolve(change: DetectedChange): Promise<Evidence[]> {
    const out: Evidence[] = [];
    for (const url of change.docUrls.filter((u) => this.allowed(u))) {
      const res = await this.fetchImpl(url, { headers: { "User-Agent": "release-notes-agent" }, redirect: "follow" });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      const html = await res.text();
      const text = htmlToText(html);
      if (text.length < 40) continue;
      out.push({ id: `doc:${url}`, type: "doc", title: htmlTitle(html) ?? url, url, text });
    }
    return out;
  }
}

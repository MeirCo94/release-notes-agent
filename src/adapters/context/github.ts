import type { DetectedChange, Evidence } from "../../types.js";
import type { ContextProvider } from "../types.js";

/** GitHub pull requests linked in the announcement (fine-grained token with Pull requests: read). */
export class GitHubPrProvider implements ContextProvider {
  readonly name = "github";
  constructor(private opts: { token?: string }, private fetchImpl: typeof fetch = fetch) {}

  async resolve(change: DetectedChange): Promise<Evidence[]> {
    const out: Evidence[] = [];
    for (const url of change.prUrls) {
      const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!m) continue;
      const [, owner, repo, num] = m;
      const res = await this.fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "release-notes-agent",
          ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
        },
      });
      if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${owner}/${repo}#${num}`);
      const pr = (await res.json()) as any;
      const body = (pr.body ?? "").trim();
      out.push({
        id: `pr:${owner}/${repo}#${num}`,
        type: "pull_request",
        title: `${owner}/${repo}#${num}: ${pr.title}`,
        url: pr.html_url ?? url,
        text: [`Merged: ${pr.merged_at ?? "not merged"}`, `Labels: ${(pr.labels ?? []).map((l: any) => l.name).join(", ") || "none"}`, "", body || "(no description)"].join("\n"),
      });
    }
    return out;
  }
}

import type { DetectedChange, Evidence } from "../../types.js";
import type { ContextProvider } from "../types.js";

/** Flattens Atlassian Document Format (Jira Cloud v3 rich text) to plain text. */
export function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(adfToText).join(node.type === "bulletList" || node.type === "orderedList" ? "\n" : "");
  return ["paragraph", "heading", "listItem", "codeBlock"].includes(node.type) ? `${inner}\n` : inner;
}

/** Jira Cloud via REST with an API token (https://id.atlassian.com/manage-profile/security/api-tokens). */
export class JiraProvider implements ContextProvider {
  readonly name = "jira";
  constructor(
    private opts: { baseUrl: string; email: string; apiToken: string; projectKeys?: string[] },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async resolve(change: DetectedChange): Promise<Evidence[]> {
    const keys = change.jiraKeys.filter(
      (k) => !this.opts.projectKeys?.length || this.opts.projectKeys.includes(k.split("-")[0]),
    );
    const auth = Buffer.from(`${this.opts.email}:${this.opts.apiToken}`).toString("base64");
    const base = this.opts.baseUrl.replace(/\/$/, "");
    const out: Evidence[] = [];
    for (const key of keys) {
      const res = await this.fetchImpl(
        `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype,status,labels,components`,
        { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
      );
      if (res.status === 404) continue; // not a real ticket, e.g. "UTF-8" matched the key pattern
      if (!res.ok) throw new Error(`Jira returned ${res.status} for ${key}`);
      const issue = (await res.json()) as any;
      const f = issue.fields ?? {};
      const meta = [
        f.issuetype?.name && `Type: ${f.issuetype.name}`,
        f.status?.name && `Status: ${f.status.name}`,
        f.components?.length && `Components: ${f.components.map((c: any) => c.name).join(", ")}`,
        f.labels?.length && `Labels: ${f.labels.join(", ")}`,
      ].filter(Boolean);
      const description = adfToText(f.description).trim();
      if (!description && !f.summary) continue;
      out.push({
        id: `jira:${key}`,
        type: "jira",
        title: `${key}: ${f.summary ?? ""}`.trim(),
        url: `${base}/browse/${key}`,
        text: [...meta, "", description || "(no description)"].join("\n"),
      });
    }
    return out;
  }
}

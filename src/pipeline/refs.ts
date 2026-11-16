import type { SourceRefs } from "../types.js";

// Deterministic link extraction. The LLM also reports refs, but we always union in
// what these patterns find so a link in a message can never be silently dropped.

const JIRA_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;
const URL = /https?:\/\/[^\s<>|)"']+/g;
const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const JIRA_URL = /\/browse\/([A-Z][A-Z0-9]{1,9}-\d{1,6})/;

/** Slack wraps links as <url|label>; normalise them to bare URLs first. */
export function normaliseSlackLinks(text: string): string {
  return text.replace(/<(https?:\/\/[^|>]+)(\|[^>]*)?>/g, "$1");
}

export function extractRefs(rawText: string): SourceRefs {
  const text = normaliseSlackLinks(rawText);
  const jira = new Set<string>();
  const prs = new Set<string>();
  const docs = new Set<string>();

  for (const url of text.match(URL) ?? []) {
    const clean = url.replace(/[.,;:]+$/, "");
    const pr = clean.match(PR_URL);
    const jiraInUrl = clean.match(JIRA_URL);
    if (pr) prs.add(pr[0]);
    else if (jiraInUrl) jira.add(jiraInUrl[1]);
    else docs.add(clean);
  }
  // Jira keys written inline; skip ones that are only part of a URL we already handled.
  const withoutUrls = text.replace(URL, " ");
  for (const m of withoutUrls.matchAll(JIRA_KEY)) jira.add(m[1]);

  return { jiraKeys: [...jira], prUrls: [...prs], docUrls: [...docs] };
}

export function mergeRefs(a: SourceRefs, b: SourceRefs): SourceRefs {
  const u = (x: string[], y: string[]) => [...new Set([...x, ...y])];
  return {
    jiraKeys: u(a.jiraKeys, b.jiraKeys),
    prUrls: u(a.prUrls, b.prUrls),
    docUrls: u(a.docUrls, b.docUrls),
  };
}

/** Explicit version labels only: "v2.14.0", "version 2.14", "release 2026.11.16". */
export function extractVersion(text: string): string | undefined {
  const m = text.match(/(?:\bv|\b(?:version|release)\s+v?)(\d+(?:\.\d+){1,3}(?:-[\w.]+)?)\b/i);
  return m?.[1];
}

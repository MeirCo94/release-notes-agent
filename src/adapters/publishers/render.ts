import type { Audience, AudienceDef, Evidence, NoteItem, ReleaseDraft } from "../../types.js";

// A destination-neutral outline of a draft. Each publisher turns this into its own format,
// so every destination gets the same sections and metadata.

/** Section heading for an audience. Internal teams are labelled so reviewers never mistake them for public copy. */
export const audienceHeading = (a: AudienceDef) => (a.public ? `For ${a.label}` : `${a.label} (internal)`);
export const KIND_LABEL = { feature: "New", improvement: "Improved", fix: "Fixed", internal: "Internal" } as const;
export const NEEDS_REVIEW = "Needs review";

export interface OutlineItem {
  item: NoteItem;
  meta: string;
  sources: { label: string; url: string }[];
}
export interface Outline {
  title: string;
  metadata: { label: string; value: string; links?: { label: string; url: string }[] }[];
  reviewSummary: string;
  sections: { audience: Audience; heading: string; items: OutlineItem[] }[];
  evidence: Evidence[];
}

export function buildOutline(draft: ReleaseDraft): Outline {
  const evidenceById = new Map(draft.evidence.map((e) => [e.id, e]));
  const b = draft.batch;
  const jira = [...new Set(b.changes.flatMap((c) => c.jiraKeys))];
  const prs = [...new Set(b.changes.flatMap((c) => c.prUrls))];
  const jiraUrl = (key: string) => evidenceById.get(`jira:${key}`)?.url;
  const flagged = draft.items.filter((i) => i.status === "needs_review").length;

  const metadata: Outline["metadata"] = [
    { label: "Release date", value: b.date },
    { label: "Version", value: b.version ?? "Not stated in the announcement" },
    { label: "Status", value: "Draft, not published" },
    {
      label: "Slack messages",
      value: String(b.messages.length),
      links: b.messages.map((m, i) => ({ label: `Message ${i + 1} (${m.postedAt.slice(0, 16).replace("T", " ")} UTC)`, url: m.permalink ?? "" })).filter((l) => l.url),
    },
    {
      label: "Jira tickets",
      value: jira.length ? jira.join(", ") : "None linked",
      links: jira.map((k) => ({ label: k, url: jiraUrl(k) ?? "" })).filter((l) => l.url),
    },
    { label: "Pull requests", value: prs.length ? String(prs.length) : "None linked", links: prs.map((u) => ({ label: u.replace("https://github.com/", ""), url: u })) },
  ];

  const sections = draft.audiences
    .map((def) => ({
      audience: def.id,
      heading: audienceHeading(def),
      items: draft.items
        .filter((i) => i.audience === def.id)
        .sort((x, y) => x.area.localeCompare(y.area) || x.kind.localeCompare(y.kind))
        .map((item) => ({
          item,
          meta: `${item.area} · ${KIND_LABEL[item.kind]}`,
          sources: item.citations
            .map((c) => evidenceById.get(c))
            .filter((e): e is Evidence => !!e)
            .map((e) => ({ label: e.title, url: e.url })),
        })),
    }))
    .filter((s) => s.items.length > 0);

  return {
    title: draft.title,
    metadata,
    reviewSummary: flagged
      ? `${flagged} of ${draft.items.length} entries need review because no linked source explains them. They restate the announcement only. Add a source or rewrite them, then delete the "${NEEDS_REVIEW}" note.`
      : `All ${draft.items.length} entries are backed by linked sources. Check the wording, then set Status to Approved.`,
    sections,
    evidence: draft.evidence,
  };
}

export function outlineToMarkdown(o: Outline): string {
  const lines: string[] = [`# ${o.title}`, ""];
  for (const m of o.metadata) {
    const links = m.links?.length ? ` (${m.links.map((l) => `[${l.label}](${l.url})`).join(", ")})` : "";
    lines.push(`- **${m.label}:** ${m.value}${links}`);
  }
  lines.push("", `> ${o.reviewSummary}`, "");
  for (const s of o.sections) {
    lines.push(`## ${s.heading}`, "");
    for (const { item, meta, sources } of s.items) {
      lines.push(`### ${item.title}`, `_${meta}_`, "");
      if (item.status === "needs_review") lines.push(`> **${NEEDS_REVIEW}:** ${item.reviewReason ?? ""}`, "");
      lines.push(item.body, "");
      if (sources.length) lines.push(`Sources: ${sources.map((x) => `[${x.label}](${x.url})`).join(", ")}`, "");
    }
  }
  if (o.evidence.length) {
    lines.push("## Sources consulted", "");
    for (const e of o.evidence) lines.push(`- [${e.title}](${e.url})`);
  }
  return lines.join("\n") + "\n";
}

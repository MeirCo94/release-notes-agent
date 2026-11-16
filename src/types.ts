// Core domain types. Nothing in here knows about Slack, Notion, Jira, etc.

/** One message read from the deploy-announcements channel (Slack, Discord, ...). */
export interface ChatMessage {
  id: string;
  channel: string;
  author: string;
  /** ISO 8601 timestamp */
  postedAt: string;
  text: string;
  /** Link back to the original message, if the source can produce one. */
  permalink?: string;
}

export type ChangeKind = "feature" | "improvement" | "fix" | "internal";

/** References found in a message that may support a change. */
export interface SourceRefs {
  jiraKeys: string[];
  prUrls: string[];
  docUrls: string[];
}

/** A single product change detected in a chat message. */
export interface DetectedChange extends SourceRefs {
  id: string;
  messageId: string;
  /** Close paraphrase of what the message says. Never expanded beyond the message. */
  summary: string;
  kind: ChangeKind;
}

/** Messages and changes that belong to one release (by version) or one day. */
export interface ReleaseBatch {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  version?: string;
  messages: ChatMessage[];
  changes: DetectedChange[];
}

export type EvidenceType = "jira" | "pull_request" | "doc";

/** A piece of linked source material retrieved for a change. */
export interface Evidence {
  /** Stable id used in citations, e.g. "jira:KRT-123". */
  id: string;
  type: EvidenceType;
  title: string;
  url: string;
  /** Plain-text body (ticket description, PR body, doc text). */
  text: string;
}

/** Id of an audience defined in the audiences config (e.g. "customer-support", "sales"). */
export type Audience = string;

/**
 * Someone who needs their own version of the notes. Defined in config, so any company can use its
 * own teams. `public` audiences are end users: their approved notes can be shown in your product.
 * Non-public audiences are internal teams and never leave the review destination.
 */
export interface AudienceDef {
  id: Audience;
  label: string;
  /** What this audience cares about and how to write for them. Used as guidance for the model. */
  description: string;
  public: boolean;
}

export type ItemStatus = "supported" | "needs_review";

/** One release-note entry for one audience. */
export interface NoteItem {
  changeId: string;
  audience: Audience;
  kind: ChangeKind;
  /** Product area used for grouping, from the product context (e.g. "Peer evaluation"). */
  area: string;
  title: string;
  body: string;
  /** Evidence ids that back the body. Empty only when status is needs_review. */
  citations: string[];
  status: ItemStatus;
  reviewReason?: string;
}

export type DraftStatus = "draft" | "approved" | "published";

export interface ReleaseDraft {
  id: string;
  batch: ReleaseBatch;
  title: string;
  items: NoteItem[];
  /** The audiences this draft was written for (a snapshot, so later config changes don't alter old drafts). */
  audiences: AudienceDef[];
  evidence: Evidence[];
  status: DraftStatus;
  createdAt: string;
  /** Where the draft lives in the destination (Notion page, Google Doc, file). */
  destination?: { name: string; id: string; url: string };
  approvedAt?: string;
}

/** High-level product description used to group and title changes. */
export interface ProductContext {
  name: string;
  summary: string;
  /** Product areas and the workflows they cover, used as grouping buckets. */
  areas: { name: string; description: string }[];
  sources: string[];
}

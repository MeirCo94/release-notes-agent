// Adapter interfaces. Swap a vendor by writing a new class that implements one of these.
import type {
  ChatMessage,
  DetectedChange,
  DraftStatus,
  Evidence,
  NoteItem,
  ProductContext,
  ReleaseDraft,
} from "../types.js";

/** Where deploy announcements come from (Slack, Discord, a JSON file, ...). */
export interface ChatSource {
  readonly name: string;
  fetchMessages(range: { since: Date; until: Date }): Promise<ChatMessage[]>;
}

/** Fetches linked material (Jira, GitHub PRs, docs) that can support a change. */
export interface ContextProvider {
  readonly name: string;
  resolve(change: DetectedChange): Promise<Evidence[]>;
}

/** Product description used to group and title notes for end users. */
export interface ProductContextSource {
  load(): Promise<ProductContext>;
}

/** Edited audience sections read back from the destination after review. */
export interface ReviewedDraft {
  status: DraftStatus;
  /** Replacement items, if the reviewer edited them in the destination. */
  items?: NoteItem[];
}

/** Where drafts are written for a product person to review (Notion, Google Docs, Markdown). */
export interface DraftPublisher {
  readonly name: string;
  publish(draft: ReleaseDraft): Promise<{ id: string; url: string }>;
  /** Optional: read the review status (and edits) back from the destination. */
  readReview?(draft: ReleaseDraft): Promise<ReviewedDraft | null>;
}

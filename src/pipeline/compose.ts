import type { ContextProvider } from "../adapters/types.js";
import type { Llm } from "../llm.js";
import type {
  Audience,
  ChatMessage,
  DetectedChange,
  Evidence,
  NoteItem,
  ProductContext,
  ReleaseBatch,
  ReleaseDraft,
} from "../types.js";

/** Fetch evidence for one change from every provider. A failing provider never fails the run. */
export async function retrieveEvidence(
  change: DetectedChange,
  providers: ContextProvider[],
  log: (msg: string) => void = console.warn,
): Promise<{ evidence: Evidence[]; gaps: string[] }> {
  const evidence: Evidence[] = [];
  const gaps: string[] = [];
  const results = await Promise.allSettled(providers.map((p) => p.resolve(change)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") evidence.push(...r.value);
    else {
      const msg = `${providers[i].name} could not be reached: ${(r.reason as Error)?.message ?? r.reason}`;
      gaps.push(msg);
      log(msg);
    }
  });
  // Deduplicate by id (two changes can share a ticket, two providers can return the same doc).
  const seen = new Set<string>();
  return { evidence: evidence.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))), gaps };
}

/** The fallback entry when we can't back a note with sources: restate, don't explain. */
function needsReview(change: DetectedChange, audience: Audience, area: string, reason: string): NoteItem {
  return {
    changeId: change.id,
    audience,
    kind: change.kind,
    area,
    title: change.summary,
    body: `From the deploy announcement: "${change.summary}"`,
    citations: [],
    status: "needs_review",
    reviewReason: reason,
  };
}

/**
 * Write note entries for a change, then enforce the sourcing rule in code (not just in the prompt):
 *  - no evidence at all            -> needs_review, the model is not asked to write anything
 *  - model says it isn't supported -> needs_review
 *  - cites ids that weren't given  -> needs_review
 *  - cites nothing                 -> needs_review
 */
export async function composeChange(args: {
  llm: Llm;
  change: DetectedChange;
  message: ChatMessage;
  evidence: Evidence[];
  gaps: string[];
  product: ProductContext;
  audiences: Audience[];
}): Promise<NoteItem[]> {
  const { llm, change, message, evidence, gaps, product } = args;
  // Internal-only changes are only written for the internal audience.
  const audiences = change.kind === "internal" ? args.audiences.filter((a) => a === "internal") : args.audiences;
  if (audiences.length === 0) return [];

  if (evidence.length === 0) {
    const refs = change.jiraKeys.length + change.prUrls.length + change.docUrls.length;
    const reason =
      refs === 0
        ? "No Jira ticket, pull request or doc is linked in the announcement."
        : `Linked sources could not be read${gaps.length ? ` (${gaps.join("; ")})` : ""}.`;
    return audiences.map((a) => needsReview(change, a, "Other", reason));
  }

  let composition;
  try {
    composition = await llm.compose({ change, message, evidence, product, audiences });
  } catch (err) {
    return audiences.map((a) => needsReview(change, a, "Other", `Draft could not be generated: ${(err as Error).message}`));
  }

  const validIds = new Set(evidence.map((e) => e.id));
  const knownAreas = new Set([...product.areas.map((a) => a.name), "Other"]);
  const area = knownAreas.has(composition.area) ? composition.area : "Other";

  const items: NoteItem[] = [];
  for (const audience of audiences) {
    const entry = composition.entries.find((e) => e.audience === audience);
    if (!entry) {
      items.push(needsReview(change, audience, area, "No entry was generated for this audience."));
      continue;
    }
    if (!entry.relevant) continue;
    const citations = [...new Set(entry.citations)];
    const unknown = citations.filter((c) => !validIds.has(c));
    let reason: string | undefined;
    if (!entry.supported) reason = entry.reviewReason ?? "The linked sources don't explain this change.";
    else if (citations.length === 0) reason = "The entry doesn't cite any source.";
    else if (unknown.length) reason = `The entry cites sources that weren't provided: ${unknown.join(", ")}.`;

    items.push(
      reason
        ? { ...needsReview(change, audience, area, reason), title: entry.title || change.summary }
        : {
            changeId: change.id,
            audience,
            kind: change.kind,
            area,
            title: entry.title,
            body: entry.body,
            citations,
            status: "supported",
          },
    );
  }
  return items;
}

const fmtTitle = (b: ReleaseBatch) => (b.version ? `Release ${b.version} (${b.date})` : `Product updates, ${b.date}`);

export async function buildDraft(args: {
  llm: Llm;
  batch: ReleaseBatch;
  providers: ContextProvider[];
  product: ProductContext;
  audiences: Audience[];
}): Promise<ReleaseDraft> {
  const { batch } = args;
  const messages = new Map(batch.messages.map((m) => [m.id, m]));
  const allEvidence = new Map<string, Evidence>();
  const items: NoteItem[] = [];

  for (const change of batch.changes) {
    const { evidence, gaps } = await retrieveEvidence(change, args.providers);
    evidence.forEach((e) => allEvidence.set(e.id, e));
    items.push(
      ...(await composeChange({
        llm: args.llm,
        change,
        message: messages.get(change.messageId)!,
        evidence,
        gaps,
        product: args.product,
        audiences: args.audiences,
      })),
    );
  }

  return {
    id: `draft_${batch.id}`,
    batch,
    title: fmtTitle(batch),
    items,
    evidence: [...allEvidence.values()],
    status: "draft",
    createdAt: new Date().toISOString(),
  };
}

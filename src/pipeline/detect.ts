import { createHash } from "node:crypto";
import type { Llm } from "../llm.js";
import type { ChatMessage, DetectedChange, ReleaseBatch } from "../types.js";
import { extractRefs, extractVersion, mergeRefs } from "./refs.js";

export interface DetectedMessage {
  message: ChatMessage;
  version?: string;
  changes: DetectedChange[];
}

const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);

/** Ask the model which messages are deploy announcements and what changed in each. */
export async function detectChanges(llm: Llm, messages: ChatMessage[], batchSize = 25): Promise<DetectedMessage[]> {
  const out: DetectedMessage[] = [];
  for (let i = 0; i < messages.length; i += batchSize) {
    const slice = messages.slice(i, i + batchSize);
    const detection = await llm.detect(slice);
    const byId = new Map(detection.messages.map((d) => [d.messageId, d]));

    for (const message of slice) {
      const d = byId.get(message.id);
      if (!d?.isDeployAnnouncement || d.changes.length === 0) continue;
      const linked = extractRefs(message.text);
      // If the message has a single change, every link in it belongs to that change.
      // With several changes, keep the model's attribution but never lose a link: links the
      // model did not attribute to any change are attached to all of them.
      const attributed = new Set(d.changes.flatMap((c) => [...c.jiraKeys, ...c.prUrls, ...c.docUrls]));
      const unattributed = {
        jiraKeys: linked.jiraKeys.filter((k) => !attributed.has(k)),
        prUrls: linked.prUrls.filter((k) => !attributed.has(k)),
        docUrls: linked.docUrls.filter((k) => !attributed.has(k)),
      };
      const changes = d.changes.map((c, idx) => {
        const refs = mergeRefs({ jiraKeys: c.jiraKeys, prUrls: c.prUrls, docUrls: c.docUrls }, unattributed);
        return {
          id: `chg_${shortHash(`${message.id}:${idx}:${c.summary}`)}`,
          messageId: message.id,
          summary: c.summary,
          kind: c.kind,
          ...refs,
        } satisfies DetectedChange;
      });
      out.push({ message, version: d.version ?? extractVersion(message.text), changes });
    }
  }
  return out;
}

export type GroupingMode = "release" | "day";

/**
 * Group detected messages into batches. "release" groups messages that share a version and
 * falls back to the day for messages without one. "day" always groups by calendar day.
 */
export function groupIntoBatches(detected: DetectedMessage[], mode: GroupingMode, timeZone = "UTC"): ReleaseBatch[] {
  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

  const batches = new Map<string, ReleaseBatch>();
  for (const d of detected) {
    const date = dayOf(d.message.postedAt);
    const key = mode === "release" && d.version ? `v:${d.version}` : `d:${date}`;
    let b = batches.get(key);
    if (!b) {
      b = {
        id: `rel_${shortHash(key)}`,
        date,
        version: mode === "release" ? d.version : undefined,
        messages: [],
        changes: [],
      };
      batches.set(key, b);
    }
    // Release date = the day of the earliest message announcing it.
    if (date < b.date) b.date = date;
    b.messages.push(d.message);
    b.changes.push(...d.changes);
  }
  return [...batches.values()].sort((a, b) => a.date.localeCompare(b.date));
}

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ReleaseDraft } from "../../types.js";
import type { DraftPublisher } from "../types.js";
import { buildOutline, outlineToMarkdown } from "./render.js";

/** Writes drafts as Markdown files. Approval then happens in the review screen. */
export class MarkdownPublisher implements DraftPublisher {
  readonly name = "markdown";
  constructor(private dir = "out") {}
  async publish(draft: ReleaseDraft) {
    await mkdir(this.dir, { recursive: true });
    const path = resolve(join(this.dir, `${draft.batch.date}-${draft.id}.md`));
    await writeFile(path, outlineToMarkdown(buildOutline(draft)));
    return { id: path, url: `file://${path}` };
  }
}

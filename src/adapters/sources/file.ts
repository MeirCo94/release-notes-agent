import { readFile } from "node:fs/promises";
import type { ChatMessage } from "../../types.js";
import type { ChatSource } from "../types.js";

/** Reads messages from a JSON file. Useful for demos, tests and backfills from an export. */
export class FileSource implements ChatSource {
  readonly name = "file";
  constructor(private path: string) {}
  async fetchMessages({ since, until }: { since: Date; until: Date }): Promise<ChatMessage[]> {
    const all = JSON.parse(await readFile(this.path, "utf8")) as ChatMessage[];
    return all.filter((m) => {
      const t = new Date(m.postedAt);
      return t >= since && t <= until;
    });
  }
}

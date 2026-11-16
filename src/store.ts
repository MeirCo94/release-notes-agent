import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReleaseDraft } from "./types.js";

interface StoreShape {
  drafts: ReleaseDraft[];
  /** Message ids already turned into drafts, so re-runs don't duplicate work. */
  processedMessageIds: string[];
  lastRunAt?: string;
}

/** Small JSON-file store. Swap for Postgres/SQLite when you deploy more than one instance. */
export class JsonStore {
  private data?: StoreShape;
  constructor(private path = "data/store.json") {}

  private async load(): Promise<StoreShape> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.path, "utf8"));
    } catch {
      this.data = { drafts: [], processedMessageIds: [] };
    }
    return this.data!;
  }
  private async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.path);
  }

  async drafts() {
    return (await this.load()).drafts.slice().sort((a, b) => b.batch.date.localeCompare(a.batch.date));
  }
  async draft(id: string) {
    return (await this.load()).drafts.find((d) => d.id === id);
  }
  async upsertDraft(d: ReleaseDraft) {
    const s = await this.load();
    const i = s.drafts.findIndex((x) => x.id === d.id);
    if (i >= 0) s.drafts[i] = d;
    else s.drafts.push(d);
    await this.save();
  }
  async processed(): Promise<Set<string>> {
    return new Set((await this.load()).processedMessageIds);
  }
  async markProcessed(ids: string[]) {
    const s = await this.load();
    s.processedMessageIds = [...new Set([...s.processedMessageIds, ...ids])];
    s.lastRunAt = new Date().toISOString();
    await this.save();
  }
  async lastRunAt() {
    return (await this.load()).lastRunAt;
  }
}

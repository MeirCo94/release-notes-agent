import type { ReleaseDraft } from "../../types.js";
import type { DraftPublisher } from "../types.js";
import { buildOutline, NEEDS_REVIEW } from "./render.js";

/**
 * Writes each draft as a new Google Doc (optionally inside a Drive folder). Uses an OAuth refresh
 * token for a Google account with the Docs and Drive scopes. Approval then happens in the review
 * screen, since Docs has no status field to read back.
 */
export class GoogleDocsPublisher implements DraftPublisher {
  readonly name = "google-docs";
  constructor(
    private opts: { clientId: string; clientSecret: string; refreshToken: string; folderId?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async token(): Promise<string> {
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        refresh_token: this.opts.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
    return ((await res.json()) as any).access_token;
  }

  async publish(draft: ReleaseDraft) {
    const o = buildOutline(draft);
    // Build the text and remember which ranges get which paragraph style.
    let body = "";
    const styles: { start: number; end: number; style: string }[] = [];
    const add = (line: string, style = "NORMAL_TEXT") => {
      const start = body.length + 1; // Docs indexes start at 1
      body += line + "\n";
      styles.push({ start, end: body.length + 1, style });
    };
    for (const m of o.metadata) add(`${m.label}: ${m.value}${m.links?.length ? ` (${m.links.map((l) => l.url).join(", ")})` : ""}`);
    add(o.reviewSummary);
    for (const s of o.sections) {
      add(s.heading, "HEADING_2");
      for (const { item, meta, sources } of s.items) {
        add(item.title, "HEADING_3");
        add(meta);
        if (item.status === "needs_review") add(`⚠️ ${NEEDS_REVIEW}: ${item.reviewReason ?? ""}`);
        add(item.body);
        if (sources.length) add(`Sources: ${sources.map((x) => `${x.label} (${x.url})`).join(", ")}`);
      }
    }

    const auth = { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" };
    const created = await this.fetchImpl("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ title: o.title }),
    });
    if (!created.ok) throw new Error(`Google Docs create failed: ${created.status}`);
    const doc = (await created.json()) as any;

    const requests: any[] = [{ insertText: { location: { index: 1 }, text: body } }];
    for (const s of styles.filter((x) => x.style !== "NORMAL_TEXT")) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: s.start, endIndex: s.end },
          paragraphStyle: { namedStyleType: s.style },
          fields: "namedStyleType",
        },
      });
    }
    const upd = await this.fetchImpl(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ requests }),
    });
    if (!upd.ok) throw new Error(`Google Docs update failed: ${upd.status}`);

    if (this.opts.folderId) {
      await this.fetchImpl(
        `https://www.googleapis.com/drive/v3/files/${doc.documentId}?addParents=${this.opts.folderId}&removeParents=root`,
        { method: "PATCH", headers: auth },
      );
    }
    return { id: doc.documentId as string, url: `https://docs.google.com/document/d/${doc.documentId}/edit` };
  }
}

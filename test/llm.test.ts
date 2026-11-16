import { describe, expect, it } from "vitest";
import { ClaudeLlm } from "../src/llm.js";
import { audiences, product, msg } from "./helpers.js";

function fakeClient(parsed: unknown, stop_reason = "end_turn") {
  const calls: any[] = [];
  const client = { beta: { messages: { parse: async (args: any) => { calls.push(args); return { stop_reason, parsed_output: parsed }; } } } } as any;
  return { client, calls };
}
const change = { id: "c1", messageId: "m1", summary: "Added SSO", kind: "feature" as const, jiraKeys: [], prUrls: [], docUrls: [] };

describe("ClaudeLlm.compose", () => {
  it("describes every configured audience to the model, marking which are public", async () => {
    const { client, calls } = fakeClient({ area: "Other", entries: [] });
    await new ClaudeLlm("claude-opus-5-5", client).compose({
      change, message: msg("m1", "Added SSO"), evidence: [], product, audiences,
    });
    const prompt: string = calls[0].messages[0].content;
    expect(prompt).toContain('id "customers" (Customers, end users');
    expect(prompt).toContain('id "customer-support" (Customer Support, internal team): Answers tickets.');
    expect(prompt).toContain('id "sales" (Sales, internal team): Talks to prospects.');
    expect(prompt).toContain('id "customer-success" (Customer Success, internal team)');
    expect(calls[0].system).toContain("Acme Projects");
    expect(calls[0].fallbacks).toBe("default");
  });

  it("fails loudly on refusals and truncated output instead of returning partial notes", async () => {
    const run = (stop: string) => new ClaudeLlm("claude-opus-5-5", fakeClient({}, stop).client).compose({ change, message: msg("m1", "x"), evidence: [], product, audiences });
    await expect(run("refusal")).rejects.toThrow(/declined/);
    await expect(run("max_tokens")).rejects.toThrow(/cut off/);
  });
});

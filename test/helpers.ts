import type { Composition, Detection, Llm } from "../src/llm.js";
import type { ContextProvider } from "../src/adapters/types.js";
import type { ChatMessage, DetectedChange, Evidence, ProductContext } from "../src/types.js";

export const product: ProductContext = {
  name: "Kritik",
  summary: "Peer assessment platform.",
  areas: [{ name: "Activity creation", description: "" }, { name: "Peer evaluation", description: "" }],
  sources: [],
};

export const msg = (id: string, text: string, postedAt = "2026-11-10T15:00:00Z"): ChatMessage => ({
  id, channel: "deploys", author: "bot", postedAt, text, permalink: `https://example.slack.com/${id}`,
});

/** Fake model: detection and composition are scripted per test. */
export class FakeLlm implements Llm {
  composeCalls = 0;
  constructor(
    private detection: (m: ChatMessage[]) => Detection,
    private composition: (c: DetectedChange, e: Evidence[]) => Composition = defaultCompose,
  ) {}
  async detect(m: ChatMessage[]) { return this.detection(m); }
  async compose({ change, evidence }: { change: DetectedChange; evidence: Evidence[] }) {
    this.composeCalls++;
    return this.composition(change, evidence);
  }
}

export function defaultCompose(change: DetectedChange, evidence: Evidence[]): Composition {
  return {
    area: "Activity creation",
    entries: (["instructor", "student", "internal"] as const).map((audience) => ({
      audience, relevant: true, title: change.summary, body: `Explained by ${evidence.map((e) => e.id).join(", ")}`,
      citations: evidence.map((e) => e.id), supported: true, reviewReason: null,
    })),
  };
}

export class FakeJira implements ContextProvider {
  readonly name = "jira";
  constructor(private known: Record<string, string>) {}
  async resolve(c: DetectedChange): Promise<Evidence[]> {
    return c.jiraKeys.filter((k) => this.known[k]).map((k) => ({
      id: `jira:${k}`, type: "jira" as const, title: k, url: `https://jira.example/browse/${k}`, text: this.known[k],
    }));
  }
}
export class BrokenProvider implements ContextProvider {
  readonly name = "github";
  async resolve(): Promise<Evidence[]> { throw new Error("401 Unauthorized"); }
}

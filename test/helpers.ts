import type { Composition, Detection, Llm } from "../src/llm.js";
import type { ContextProvider } from "../src/adapters/types.js";
import type { AudienceDef, ChatMessage, DetectedChange, Evidence, ProductContext } from "../src/types.js";

export const product: ProductContext = {
  name: "Acme Projects",
  summary: "Project management software.",
  areas: [{ name: "Projects and tasks", description: "" }, { name: "Reporting", description: "" }],
  sources: [],
};

/** One public audience and the three internal teams a typical company has. */
export const audiences: AudienceDef[] = [
  { id: "customers", label: "Customers", description: "People who use the product.", public: true },
  { id: "customer-support", label: "Customer Support", description: "Answers tickets.", public: false },
  { id: "sales", label: "Sales", description: "Talks to prospects.", public: false },
  { id: "customer-success", label: "Customer Success", description: "Owns adoption.", public: false },
];
export const aud = (...ids: string[]) => audiences.filter((a) => ids.includes(a.id));

export const msg = (id: string, text: string, postedAt = "2026-11-10T15:00:00Z"): ChatMessage => ({
  id, channel: "deploys", author: "bot", postedAt, text, permalink: `https://example.slack.com/${id}`,
});

/** Fake model: detection and composition are scripted per test. */
export class FakeLlm implements Llm {
  composeCalls = 0;
  constructor(
    private detection: (m: ChatMessage[]) => Detection,
    private composition: (c: DetectedChange, e: Evidence[], a: AudienceDef[]) => Composition = defaultCompose,
  ) {}
  async detect(m: ChatMessage[]) { return this.detection(m); }
  async compose({ change, evidence, audiences }: { change: DetectedChange; evidence: Evidence[]; audiences: AudienceDef[] }) {
    this.composeCalls++;
    return this.composition(change, evidence, audiences);
  }
}

export function defaultCompose(change: DetectedChange, evidence: Evidence[], audiences: AudienceDef[]): Composition {
  return {
    area: "Projects and tasks",
    entries: audiences.map((a) => ({
      audience: a.id, relevant: true, title: change.summary, body: `Explained by ${evidence.map((e) => e.id).join(", ")}`,
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

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Audience, ChatMessage, DetectedChange, Evidence, ProductContext } from "./types.js";

// --- Schemas for structured output -------------------------------------------------

export const DetectionSchema = z.object({
  messages: z.array(
    z.object({
      messageId: z.string(),
      isDeployAnnouncement: z.boolean(),
      version: z.string().nullable(),
      changes: z.array(
        z.object({
          summary: z.string(),
          kind: z.enum(["feature", "improvement", "fix", "internal"]),
          jiraKeys: z.array(z.string()),
          prUrls: z.array(z.string()),
          docUrls: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type Detection = z.infer<typeof DetectionSchema>;

export const ComposeSchema = z.object({
  area: z.string(),
  entries: z.array(
    z.object({
      audience: z.enum(["instructor", "student", "internal"]),
      relevant: z.boolean(),
      title: z.string(),
      body: z.string(),
      citations: z.array(z.string()),
      supported: z.boolean(),
      reviewReason: z.string().nullable(),
    }),
  ),
});
export type Composition = z.infer<typeof ComposeSchema>;

/** The two model calls the pipeline makes. Tests swap in a fake. */
export interface Llm {
  detect(messages: ChatMessage[]): Promise<Detection>;
  compose(input: {
    change: DetectedChange;
    message: ChatMessage;
    evidence: Evidence[];
    product: ProductContext;
    audiences: Audience[];
  }): Promise<Composition>;
}

// --- Prompts ----------------------------------------------------------------------

const DETECT_SYSTEM = `You read messages from a software team's deploy-announcements channel.
For each message decide whether it announces something that shipped. For announcements, list each
distinct product change it mentions.

Rules:
- summary: restate only what the message says, in one sentence. Do not add reasons, benefits or details that are not in the message.
- kind: feature (new capability), improvement (better existing capability), fix (bug fix), internal (infra, refactor, tooling, anything users won't notice).
- Copy Jira keys, GitHub pull request URLs and other doc URLs exactly as they appear for that change. Leave lists empty when none are given.
- version: the release identifier if the message states one, otherwise null.
- Chit-chat, rollbacks-in-progress and questions are not announcements.`;

const COMPOSE_SYSTEM = `You write release notes for {product}. You are given one product change, the Slack message
that announced it, and the linked source material (evidence). Write one entry per requested audience.

The core rule: every statement you write must be supported by the evidence. The Slack message tells you
WHAT shipped; only the evidence can tell you WHY, HOW it works, or WHO it is for.
- Cite evidence ids in "citations" for every entry you mark supported.
- If the evidence does not explain the change well enough to write a useful note for an audience, set
  supported=false, keep the body to a plain restatement of the Slack summary, and say in reviewReason what is missing.
- Never invent motivation, numbers, UI labels, or behaviour that is not in the evidence.
- relevant=false when the change does not affect that audience (e.g. internal tooling for students).

Audiences:
- instructor: professors and TAs running courses and activities. Focus on what changes in their workflow.
- student: learners submitting work and evaluating peers. Plain, short, no jargon.
- internal: support and success teams. Can include ticket detail and edge cases.

area: pick the closest product area name from the product context list. Use "Other" if none fit.
Titles are short, user-facing and in sentence case.`;

// --- Claude implementation --------------------------------------------------------

export class ClaudeLlm implements Llm {
  private client: Anthropic;
  constructor(
    private model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  private async parse<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      // Server-side fallback: if the model declines a request for policy reasons the API
      // retries it on the default fallback model instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new Error("Model declined the request");
    if (response.stop_reason === "max_tokens") throw new Error("Model output was cut off");
    if (!response.parsed_output) throw new Error("Model returned no parseable output");
    return response.parsed_output as T;
  }

  detect(messages: ChatMessage[]): Promise<Detection> {
    const body = messages
      .map((m) => `<message id="${m.id}" postedAt="${m.postedAt}" author="${m.author}">\n${m.text}\n</message>`)
      .join("\n");
    return this.parse(DETECT_SYSTEM, body, DetectionSchema);
  }

  compose({ change, message, evidence, product, audiences }: Parameters<Llm["compose"]>[0]): Promise<Composition> {
    const system = COMPOSE_SYSTEM.replace("{product}", product.name);
    const productBlock = `<product>\n${product.summary}\nAreas:\n${product.areas
      .map((a) => `- ${a.name}: ${a.description}`)
      .join("\n")}\n</product>`;
    const evidenceBlock = evidence
      .map((e) => `<evidence id="${e.id}" type="${e.type}" title=${JSON.stringify(e.title)}>\n${e.text.slice(0, 12000)}\n</evidence>`)
      .join("\n");
    const user = `${productBlock}

<slack_message>${message.text}</slack_message>
<change kind="${change.kind}">${change.summary}</change>
${evidenceBlock || "<evidence>none</evidence>"}

Write entries for these audiences: ${audiences.join(", ")}.`;
    return this.parse(system, user, ComposeSchema);
  }
}

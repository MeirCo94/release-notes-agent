import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AudienceDef } from "./types.js";

const AudienceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, numbers and dashes"),
  label: z.string().min(1),
  description: z.string().min(1),
  public: z.boolean().default(false),
});
const FileSchema = z.array(AudienceSchema).min(1, "define at least one audience");

export function parseAudiences(raw: unknown): AudienceDef[] {
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "audiences"}: ${i.message}`).join("; ");
    throw new Error(`Invalid audiences config: ${why}`);
  }
  const seen = new Set<string>();
  for (const a of parsed.data) {
    if (seen.has(a.id)) throw new Error(`Invalid audiences config: duplicate id "${a.id}"`);
    seen.add(a.id);
  }
  return parsed.data;
}

export async function loadAudiences(path: string): Promise<AudienceDef[]> {
  return parseAudiences(JSON.parse(await readFile(path, "utf8")));
}

/** Audiences whose notes may be shown to end users in your product. */
export const publicAudiences = (defs: AudienceDef[]) => defs.filter((a) => a.public);

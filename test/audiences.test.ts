import { describe, expect, it } from "vitest";
import { parseAudiences, publicAudiences } from "../src/audiences.js";
import { readFile } from "node:fs/promises";

describe("audiences config", () => {
  it("accepts any teams a company has, and defaults to internal", () => {
    const defs = parseAudiences([
      { id: "solutions-engineering", label: "Solutions Engineering", description: "Builds demos." },
      { id: "end-users", label: "End users", description: "Use the product.", public: true },
    ]);
    expect(defs.map((d) => d.public)).toEqual([false, true]);
    expect(publicAudiences(defs).map((d) => d.id)).toEqual(["end-users"]);
  });

  it.each([
    [[], /at least one/],
    [[{ id: "Sales Team", label: "x", description: "x" }], /lowercase/],
    [[{ id: "a", label: "x", description: "x" }, { id: "a", label: "y", description: "y" }], /duplicate id "a"/],
    [[{ id: "a", label: "", description: "x" }], /label/],
  ])("rejects an invalid config (%j)", (raw, message) => {
    expect(() => parseAudiences(raw)).toThrow(message);
  });

  it("ships a valid default: one public audience and Support, Sales and Success as internal teams", async () => {
    const defs = parseAudiences(JSON.parse(await readFile("audiences.json", "utf8")));
    expect(defs.filter((d) => !d.public).map((d) => d.id)).toEqual(["customer-support", "sales", "customer-success"]);
    expect(publicAudiences(defs).map((d) => d.id)).toEqual(["customers"]);
  });
});

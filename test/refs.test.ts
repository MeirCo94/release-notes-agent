import { describe, expect, it } from "vitest";
import { extractRefs, extractVersion } from "../src/pipeline/refs.js";

describe("extractRefs", () => {
  it("finds Jira keys, PR links and doc links, including Slack-formatted links", () => {
    const r = extractRefs(
      "New rubric import (KRT-1201, <https://github.com/acme/app/pull/481|#481>) docs: <https://help.example.com/rubrics> and https://acme.atlassian.net/browse/KRT-9.",
    );
    expect(r.jiraKeys.sort()).toEqual(["KRT-1201", "KRT-9"]);
    expect(r.prUrls).toEqual(["https://github.com/acme/app/pull/481"]);
    expect(r.docUrls).toEqual(["https://help.example.com/rubrics"]);
  });
  it("returns empty lists for a message with no links", () => {
    expect(extractRefs("Shipped the AI usage summary")).toEqual({ jiraKeys: [], prUrls: [], docUrls: [] });
  });
});

describe("extractVersion", () => {
  it("reads explicit version labels only", () => {
    expect(extractVersion("Release v3.42.0 is live")).toBe("3.42.0");
    expect(extractVersion("version 2.1 deployed")).toBe("2.1");
    expect(extractVersion("load time is now 1.5x faster")).toBeUndefined();
  });
});

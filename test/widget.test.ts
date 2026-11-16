// @vitest-environment jsdom
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const feed = {
  audience: "customers",
  releases: [
    { releaseId: "r2", date: "2026-11-10", version: "3.42.0", items: [
      { title: "Import a rubric", body: "Copy a rubric from another course.", kind: "feature", area: "Activity creation" },
      { title: "Timer keeps its time", body: "Switching tabs no longer resets it.", kind: "fix", area: "Peer evaluation" },
    ] },
    { releaseId: "r1", date: "2026-11-03", items: [{ title: "Faster uploads", body: "Large files upload faster.", kind: "improvement", area: "Submitting work" }] },
  ],
};

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function mount(attrs = 'audience="customers" api="https://notes.example"') {
  document.body.innerHTML = `<button id="before">before</button><release-notes-widget ${attrs}></release-notes-widget><button id="after">after</button>`;
  const el = document.querySelector("release-notes-widget") as any;
  await tick();
  return { el, root: el.shadowRoot as ShadowRoot };
}

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = "";
  await import("../public/widget.js");
});

describe("release-notes-widget", () => {
  it("loads the feed from the app or from a static feed URL", async () => {
    const f = mockFetch(feed);
    await mount();
    expect(f).toHaveBeenCalledWith("https://notes.example/api/whats-new?audience=customers", expect.anything());
    await mount('audience="customers" feed="https://cdn.example/whats-new-customers.json"');
    expect(f).toHaveBeenLastCalledWith("https://cdn.example/whats-new-customers.json", expect.anything());
  });

  it("exposes state to assistive tech: expanded state, unread text, live status, real lists and time", async () => {
    mockFetch(feed);
    const { root } = await mount();
    const toggle = root.querySelector(".toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(root.querySelector(".panel")!.id);
    expect(toggle.textContent).toContain("new updates"); // unread, in the accessible name
    expect(root.querySelector('[role="status"]')).toBeTruthy();
    expect(root.querySelectorAll("ul.items > li")).toHaveLength(3);
    expect(root.querySelector("time")!.getAttribute("datetime")).toBe("2026-11-10");
  });

  it("moves focus into the panel on open, and back to the button on Escape and on close", async () => {
    mockFetch(feed);
    const { root, el } = await mount();
    const toggle = root.querySelector<HTMLElement>(".toggle")!;
    toggle.click();
    expect(root.querySelector<HTMLElement>(".panel")!.hidden).toBe(false);
    expect(root.activeElement?.tagName).toBe("H2");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.querySelector<HTMLElement>(".panel")!.hidden).toBe(true);
    expect(root.activeElement).toBe(toggle);
    toggle.click();
    root.querySelector<HTMLElement>(".close")!.click();
    expect(root.activeElement).toBe(toggle);
    expect(el.open).toBe(false);
  });

  it("clears the unread marker once opened, and remembers it", async () => {
    mockFetch(feed);
    const { root } = await mount();
    root.querySelector<HTMLElement>(".toggle")!.click();
    expect(root.querySelector(".dot")!.classList.contains("on")).toBe(false);
    expect(root.querySelector<HTMLElement>(".badge")!.hidden).toBe(true);
    const again = await mount();
    expect(again.root.querySelector(".dot")!.classList.contains("on")).toBe(false);
  });

  it("closes when the user clicks elsewhere, without stealing focus", async () => {
    mockFetch(feed);
    const { root } = await mount();
    root.querySelector<HTMLElement>(".toggle")!.click();
    document.getElementById("after")!.click();
    expect(root.querySelector<HTMLElement>(".panel")!.hidden).toBe(true);
  });

  it("announces empty and error states, emits events, and escapes HTML", async () => {
    mockFetch({ audience: "customers", releases: [] });
    expect((await mount()).root.querySelector(".status")!.textContent).toBe("No updates yet.");

    mockFetch({}, false);
    const events: string[] = [];
    document.addEventListener("rn-error", () => events.push("rn-error"));
    expect((await mount()).root.querySelector(".status")!.textContent).toBe("Updates are unavailable right now.");
    expect(events).toEqual(["rn-error"]);

    mockFetch({ releases: [{ releaseId: "x", date: "2026-11-01", items: [{ title: "<img src=x onerror=alert(1)>", body: "<b>b</b>", kind: "fix" }] }] });
    const { root } = await mount();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("h3")!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("shows an error instead of guessing when there is no audience and no feed", async () => {
    const f = mockFetch(feed);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = await mount('api="https://notes.example"');
    expect(f).not.toHaveBeenCalled();
    expect(root.querySelector(".status")!.textContent).toBe("Updates are unavailable right now.");
    warn.mockRestore();
  });

  it("accepts any audience id", async () => {
    const f = mockFetch(feed);
    await mount('audience="enterprise-admins" api="https://notes.example"');
    expect(f).toHaveBeenCalledWith("https://notes.example/api/whats-new?audience=enterprise-admins", expect.anything());
  });

  it("supports several instances and custom strings", async () => {
    mockFetch(feed);
    document.body.innerHTML = '<release-notes-widget audience="customers" api="x"></release-notes-widget><release-notes-widget audience="partners" api="x"></release-notes-widget>';
    await tick();
    const [a, b] = Array.from(document.querySelectorAll<any>("release-notes-widget"));
    expect(a.shadowRoot.querySelector(".panel").id).not.toBe(b.shadowRoot.querySelector(".panel").id);
    a.strings = { heading: "Quoi de neuf", close: "Fermer" };
    expect(a.shadowRoot.querySelector("h2").textContent).toBe("Quoi de neuf");
    expect(a.shadowRoot.querySelector(".close").getAttribute("aria-label")).toBe("Fermer");
  });

  it("keeps the loaded notes when the heading changes", async () => {
    mockFetch(feed);
    const { el, root } = await mount();
    el.setAttribute("heading", "Product updates");
    expect(root.querySelector("h2")!.textContent).toBe("Product updates");
    expect(root.querySelectorAll("ul.items > li")).toHaveLength(3);
  });

  it("has no axe violations closed or open (contrast is checked in a real browser)", async () => {
    mockFetch(feed);
    const { root } = await mount();
    const run = () => axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect((await run()).violations).toEqual([]);
    root.querySelector<HTMLElement>(".toggle")!.click();
    expect((await run()).violations).toEqual([]);
  });
});

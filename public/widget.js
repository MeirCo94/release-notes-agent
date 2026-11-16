/*
 * <release-notes-widget> - "What's new" for any product. No dependencies, one file.
 *
 * Custom element (works in plain HTML, React/Vue, modules, injected markup, several per page):
 *
 *   <script src="https://HOST/widget.v1.js" defer></script>
 *   <release-notes-widget audience="student" api="https://HOST"></release-notes-widget>
 *
 * Or let the script tag place it for you (floating button, or inside data-target):
 *
 *   <script src="https://HOST/widget.v1.js" data-audience="instructor" defer></script>
 *
 * Attributes
 *   audience   instructor | student                       (required)
 *   api        origin of the release-notes app            (default: this script's origin)
 *   feed       full URL of a static feed JSON; skips the app entirely (see FEED_DIR in the README)
 *   heading    panel heading                              (default "What's new")
 *   theme      auto | light | dark                        (default auto = follow the OS)
 *   floating   present = fixed button in the bottom-right corner
 *
 * Theming (set on the element or any ancestor)
 *   --rn-font  --rn-accent  --rn-fg  --rn-muted  --rn-bg  --rn-tint  --rn-line  --rn-radius
 *
 * Text: set `el.strings = { loading, empty, error, newUpdates, close, kinds: { feature, improvement, fix } }`
 * Events (bubble, composed): rn-open, rn-close, rn-loaded ({detail:{releases}}), rn-error
 */
(function () {
  if (typeof window === "undefined" || window.customElements.get("release-notes-widget")) return;

  var SCRIPT_ORIGIN = (function () {
    try { return document.currentScript && new URL(document.currentScript.src).origin; } catch (e) { return null; }
  })();
  var instances = 0;

  var DEFAULT_STRINGS = {
    heading: "What's new",
    loading: "Loading updates\u2026",
    empty: "No updates yet.",
    error: "Updates are unavailable right now.",
    newUpdates: "new updates",
    close: "Close",
    kinds: { feature: "New", improvement: "Improved", fix: "Fixed" },
  };

  var CSS =
    ":host{display:inline-block;position:relative;font-family:var(--rn-font,Inter,system-ui,-apple-system,'Segoe UI',sans-serif);" +
    "--_accent:var(--rn-accent,#4f3bd6);--_fg:var(--rn-fg,#1d1b26);--_muted:var(--rn-muted,#5b5868);" +
    "--_bg:var(--rn-bg,#ffffff);--_tint:var(--rn-tint,#f4f2fd);--_line:var(--rn-line,#d9d6e3);--_radius:var(--rn-radius,12px);color:var(--_fg)}" +
    "@media (prefers-color-scheme:dark){:host(:not([theme=light])){--_accent:var(--rn-accent,#b1a6ff);--_fg:var(--rn-fg,#f1f0f5);--_muted:var(--rn-muted,#a9a6b5);--_bg:var(--rn-bg,#1c1b22);--_tint:var(--rn-tint,#29263a);--_line:var(--rn-line,#4a4757)}}" +
    ":host([theme=dark]){--_accent:var(--rn-accent,#b1a6ff);--_fg:var(--rn-fg,#f1f0f5);--_muted:var(--rn-muted,#a9a6b5);--_bg:var(--rn-bg,#1c1b22);--_tint:var(--rn-tint,#29263a);--_line:var(--rn-line,#4a4757)}" +
    ":host([floating]){position:fixed;right:20px;bottom:20px;z-index:2147483000}" +
    "*{box-sizing:border-box}" +
    ".vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
    "button{font:inherit;color:inherit;cursor:pointer}" +
    ".toggle{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:1px solid var(--_line);background:var(--_bg);border-radius:999px;font-weight:500;font-size:14px}" +
    ":host([floating]) .toggle{box-shadow:0 4px 16px rgba(0,0,0,.18)}" +
    ".dot{display:none;width:8px;height:8px;border-radius:50%;background:var(--_accent)}.dot.on{display:inline-block}" +
    ".panel{position:absolute;right:0;top:calc(100% + 8px);z-index:2147483001;width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 120px));overflow:auto;" +
    "background:var(--_bg);border:1px solid var(--_line);border-radius:var(--_radius);box-shadow:0 12px 40px rgba(0,0,0,.2)}" +
    ":host([floating]) .panel,.panel[data-above]{top:auto;bottom:calc(100% + 8px)}" +
    ".panel[hidden]{display:none}" +
    ".head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 4px 16px;border-bottom:1px solid var(--_line);position:sticky;top:0;background:var(--_bg)}" +
    "h2{margin:0;font-size:16px;font-weight:600}h2:focus{outline:none}" +
    ".close{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:0;background:none;border-radius:8px;font-size:22px;line-height:1;color:var(--_muted)}" +
    ".status{padding:24px 16px;font-size:14px;color:var(--_muted)}" +
    "ul{list-style:none;margin:0;padding:0}" +
    ".rel{padding:12px 16px;border-bottom:1px solid var(--_line)}.rel:last-child{border-bottom:0}" +
    ".date{display:block;font-size:12px;color:var(--_muted);margin-bottom:8px}" +
    ".items>li{margin:0 0 14px}.items>li:last-child{margin:0}" +
    ".tag{display:inline-block;font-size:11px;font-weight:600;color:var(--_accent);background:var(--_tint);border-radius:4px;padding:2px 6px;margin-right:6px;vertical-align:1px}" +
    "h3{display:inline;font-size:14px;font-weight:600;margin:0}p{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--_muted)}" +
    "button:focus-visible{outline:2px solid var(--_accent);outline-offset:2px}" +
    "@media (forced-colors:active){.toggle,.panel{border:1px solid CanvasText}.dot{background:Highlight;forced-color-adjust:none}}";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fmtDate(d) {
    return new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  class ReleaseNotesWidget extends HTMLElement {
    static get observedAttributes() { return ["audience", "api", "feed", "heading"]; }

    constructor() {
      super();
      this._strings = DEFAULT_STRINGS;
      this._latest = null;
      this._loaded = false;
      this._id = "rn" + ++instances;
      this._onDocKey = this._onDocKey.bind(this);
      this._onDocClick = this._onDocClick.bind(this);
      this.attachShadow({ mode: "open" });
    }

    get strings() { return this._strings; }
    set strings(v) {
      this._strings = Object.assign({}, DEFAULT_STRINGS, v || {}, { kinds: Object.assign({}, DEFAULT_STRINGS.kinds, (v && v.kinds) || {}) });
      if (this.isConnected) { this._render(); if (this._data) this._renderList(); }
    }
    get open() { return !this._panel.hidden; }

    connectedCallback() {
      if (this._started) { if (this.open) this._listen(); return; } // moved within the page: keep state
      this._started = true;
      this._render();
      this._load();
    }
    disconnectedCallback() { this._unlisten(); }
    attributeChangedCallback(name, oldV, newV) {
      // Fires for the initial attributes before connectedCallback has rendered; ignore until then.
      if (!this._started || oldV === newV) return;
      if (name === "heading") this._render();
      else { this._loaded = false; this._load(); }
    }

    _heading() { return this.getAttribute("heading") || this._strings.heading; }
    _audience() { return this.getAttribute("audience") === "instructor" ? "instructor" : "student"; }
    _seenKey() { return "rn-last-seen-" + this._audience(); }

    _url() {
      var feed = this.getAttribute("feed");
      if (feed) return feed;
      var api = (this.getAttribute("api") || SCRIPT_ORIGIN || "").replace(/\/$/, "");
      return api + "/api/whats-new?audience=" + encodeURIComponent(this._audience());
    }

    _render() {
      var s = this._strings;
      var wasOpen = this._panel ? !this._panel.hidden : false;
      this.shadowRoot.innerHTML =
        "<style>" + CSS + "</style>" +
        '<button class="toggle" type="button" aria-expanded="' + wasOpen + '" aria-controls="' + this._id + '-panel">' +
        '<span class="label">' + esc(this._heading()) + "</span>" +
        '<span class="vh badge" hidden> (' + esc(s.newUpdates) + ")</span>" +
        '<span class="dot" aria-hidden="true"></span></button>' +
        '<div class="panel" id="' + this._id + '-panel" role="region" aria-labelledby="' + this._id + '-h" ' + (wasOpen ? "" : "hidden") + ">" +
        '<div class="head"><h2 id="' + this._id + '-h" tabindex="-1">' + esc(this._heading()) + "</h2>" +
        '<button class="close" type="button" aria-label="' + esc(s.close) + '"><span aria-hidden="true">\u00d7</span></button></div>' +
        '<div class="status" role="status"></div><ul class="list" hidden></ul></div>';

      var root = this.shadowRoot;
      this._toggle = root.querySelector(".toggle");
      this._panel = root.querySelector(".panel");
      this._status = root.querySelector(".status");
      this._list = root.querySelector(".list");
      this._dot = root.querySelector(".dot");
      this._badge = root.querySelector(".badge");
      this._h = root.querySelector("h2");
      this._toggle.addEventListener("click", () => this._setOpen(this._panel.hidden));
      root.querySelector(".close").addEventListener("click", () => this._setOpen(false, true));
      this._status.textContent = this._loaded ? "" : s.loading;
      if (this._loaded && !this._data) this._status.textContent = s.error;
      if (wasOpen) this._listen();
    }

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: detail }));
    }

    _setOpen(open, returnFocus) {
      if (open === !this._panel.hidden) return;
      this._panel.hidden = !open;
      this._toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        // Clear the unread dot first: it changes the host's width, which the position depends on.
        if (this._latest) { safeSet(this._seenKey(), this._latest); this._markSeen(); }
        this._position();
        this._listen();
        this._h.focus({ preventScroll: true });
        this._emit("rn-open");
      } else {
        this._unlisten();
        if (returnFocus !== false) this._toggle.focus();
        this._emit("rn-close");
      }
    }

    // Keep the panel inside the viewport whatever the host's position on the page.
    _position() {
      this._panel.style.transform = "";
      this._panel.removeAttribute("data-above");
      var host = this.getBoundingClientRect(), h = window.innerHeight;
      var below = h - host.bottom, above = host.top;
      // Open on whichever side has more room; the panel's max-height then fits inside it.
      var up = this.hasAttribute("floating") || (below < 360 && above > below);
      if (up) this._panel.setAttribute("data-above", "");
      this._panel.style.maxHeight = Math.max(200, Math.min(560, (up ? above : below) - 16)) + "px";
      var r = this._panel.getBoundingClientRect(), w = window.innerWidth, dx = 0;
      if (r.left < 8) dx = 8 - r.left;
      else if (r.right > w - 8) dx = w - 8 - r.right;
      if (dx) this._panel.style.transform = "translateX(" + Math.round(dx) + "px)";
    }

    _markSeen() { this._dot.classList.remove("on"); this._badge.hidden = true; }

    // Non-modal: Escape closes and returns focus; clicking or tabbing elsewhere closes without stealing focus.
    _listen() {
      document.addEventListener("keydown", this._onDocKey, true);
      document.addEventListener("click", this._onDocClick, true);
      this.shadowRoot.addEventListener("focusout", this._onFocusOut = (e) => {
        var next = e.relatedTarget;
        if (next && (this.contains(next) || this.shadowRoot.contains(next))) return;
        if (next) this._setOpen(false, false);
      });
    }
    _unlisten() {
      document.removeEventListener("keydown", this._onDocKey, true);
      document.removeEventListener("click", this._onDocClick, true);
      if (this._onFocusOut) this.shadowRoot.removeEventListener("focusout", this._onFocusOut);
    }
    _onDocKey(e) { if (e.key === "Escape" && this.open) { e.stopPropagation(); this._setOpen(false, true); } }
    _onDocClick(e) { if (this.open && e.composedPath().indexOf(this) === -1) this._setOpen(false, false); }

    _load() {
      var url = this._url();
      this._status.textContent = this._strings.loading;
      this._status.hidden = false;
      this._list.hidden = true;
      fetch(url, { headers: { Accept: "application/json" } })
        .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then((data) => {
          this._data = data;
          this._loaded = true;
          this._renderList();
          this._emit("rn-loaded", { releases: data.releases || [] });
        })
        .catch((err) => {
          this._data = null;
          this._loaded = true;
          this._status.textContent = this._strings.error;
          this._emit("rn-error", { message: String(err && err.message || err) });
        });
    }

    _renderList() {
      var s = this._strings;
      var rel = (this._data && this._data.releases) || [];
      if (!rel.length) {
        this._status.hidden = false;
        this._status.textContent = s.empty;
        this._list.hidden = true;
        return;
      }
      this._status.textContent = "";
      this._status.hidden = true;
      this._latest = rel[0].releaseId;
      if (safeGet(this._seenKey()) !== this._latest && this._panel.hidden) {
        this._dot.classList.add("on");
        this._badge.hidden = false;
      }
      this._list.innerHTML = rel.map(function (r) {
        return '<li class="rel"><time class="date" datetime="' + esc(r.date) + '">' + esc(fmtDate(r.date)) + (r.version ? " \u00b7 v" + esc(r.version) : "") + "</time>" +
          '<ul class="items">' + r.items.map(function (i) {
            return '<li><span class="tag">' + esc(s.kinds[i.kind] || "Update") + "</span><h3>" + esc(i.title) + "</h3><p>" + esc(i.body) + "</p></li>";
          }).join("") + "</ul></li>";
      }).join("");
      this._list.hidden = false;
    }
  }

  window.customElements.define("release-notes-widget", ReleaseNotesWidget);

  // Script-tag mode: <script src="widget.js" data-audience="student" data-target="#slot">
  var script = document.currentScript;
  if (script && script.getAttribute("data-audience")) {
    var place = function () {
      var el = document.createElement("release-notes-widget");
      ["audience", "api", "feed", "theme"].forEach(function (a) {
        var v = script.getAttribute("data-" + a);
        if (v) el.setAttribute(a, v);
      });
      var title = script.getAttribute("data-title");
      if (title) el.setAttribute("heading", title);
      var target = script.getAttribute("data-target");
      var mount = target && document.querySelector(target);
      if (mount) mount.appendChild(el);
      else { el.setAttribute("floating", ""); document.body.appendChild(el); }
    };
    if (document.body) place(); else document.addEventListener("DOMContentLoaded", place);
  }
})();

/*
 * "What's new" widget for Kritik (or any product).
 *
 * <script src="https://<your-host>/widget.js" data-audience="instructor" defer></script>
 *
 * Options (data- attributes on the script tag):
 *   data-audience  instructor | student          (required)
 *   data-api       base URL of this app           (defaults to the script's origin)
 *   data-target    CSS selector to mount a button into; without it a floating button is shown
 *   data-title     panel heading                   (default "What's new")
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var audience = script.getAttribute("data-audience") || "student";
  var api = (script.getAttribute("data-api") || new URL(script.src).origin).replace(/\/$/, "");
  var title = script.getAttribute("data-title") || "What's new";
  var seenKey = "rna-last-seen-" + audience;
  var KIND = { feature: "New", improvement: "Improved", fix: "Fixed" };

  function getSeen() { try { return localStorage.getItem(seenKey); } catch (e) { return null; } }
  function setSeen(v) { try { localStorage.setItem(seenKey, v); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(d) { return new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }

  var host = document.createElement("div");
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    "<style>" +
    ":host{all:initial;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;--accent:#4f3bd6;--fg:#1d1b26;--muted:#6b6878;--line:#e7e5ee;--bg:#fff;--tint:#f4f2fd}" +
    "@media (prefers-color-scheme:dark){:host{--fg:#f1f0f5;--muted:#a9a6b5;--line:#33313d;--bg:#1c1b22;--tint:#29263a;--accent:#9d90ff}}" +
    ".btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:999px;padding:8px 14px;font:500 14px/1 inherit;cursor:pointer;font-family:inherit}" +
    ".btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".float{position:fixed;right:20px;bottom:20px;z-index:2147483000;box-shadow:0 4px 16px rgba(0,0,0,.12)}" +
    ".dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:none}.dot.on{display:inline-block}" +
    ".panel{position:fixed;right:20px;bottom:72px;z-index:2147483001;width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 100px));overflow:auto;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);display:none}" +
    ".panel.open{display:block}" +
    "header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg)}" +
    "h2{margin:0;font-size:16px;font-weight:600}.x{border:0;background:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1}" +
    ".rel{padding:12px 16px;border-bottom:1px solid var(--line)}.rel:last-child{border-bottom:0}" +
    ".date{font-size:12px;color:var(--muted);margin-bottom:8px}" +
    ".item{margin:0 0 12px}.item:last-child{margin:0}" +
    ".tag{display:inline-block;font-size:11px;font-weight:600;color:var(--accent);background:var(--tint);border-radius:4px;padding:2px 6px;margin-right:6px;vertical-align:1px}" +
    "h3{display:inline;font-size:14px;font-weight:600;margin:0}p{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}" +
    ".empty{padding:24px 16px;color:var(--muted);font-size:14px}" +
    "</style>" +
    '<button class="btn" part="button" aria-expanded="false"><span class="dot"></span><span class="label"></span></button>' +
    '<div class="panel" role="dialog"><header><h2></h2><button class="x" aria-label="Close">×</button></header><div class="list"><div class="empty">Loading…</div></div></div>';

  var btn = root.querySelector(".btn");
  var panel = root.querySelector(".panel");
  var list = root.querySelector(".list");
  root.querySelector(".label").textContent = title;
  root.querySelector("h2").textContent = title;
  panel.setAttribute("aria-label", title);

  var target = script.getAttribute("data-target");
  var mount = target && document.querySelector(target);
  if (mount) mount.appendChild(host);
  else { btn.classList.add("float"); document.body.appendChild(host); }

  var latest = null;
  function toggle(open) {
    panel.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
    if (open && latest) { setSeen(latest); root.querySelector(".dot").classList.remove("on"); }
  }
  btn.addEventListener("click", function () { toggle(!panel.classList.contains("open")); });
  root.querySelector(".x").addEventListener("click", function () { toggle(false); btn.focus(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); });

  fetch(api + "/api/whats-new?audience=" + encodeURIComponent(audience))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var rel = data.releases || [];
      if (!rel.length) { list.innerHTML = '<div class="empty">No updates yet.</div>'; return; }
      latest = rel[0].releaseId;
      if (getSeen() !== latest) root.querySelector(".dot").classList.add("on");
      list.innerHTML = rel.map(function (r) {
        return '<section class="rel"><div class="date">' + esc(fmtDate(r.date)) + (r.version ? " · v" + esc(r.version) : "") + "</div>" +
          r.items.map(function (i) {
            return '<div class="item"><span class="tag">' + esc(KIND[i.kind] || "Update") + "</span><h3>" + esc(i.title) + "</h3><p>" + esc(i.body) + "</p></div>";
          }).join("") + "</section>";
      }).join("");
    })
    .catch(function () { list.innerHTML = '<div class="empty">Updates are unavailable right now.</div>'; });
})();

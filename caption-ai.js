/* Gearizo studio: caption writing in the Publish tab.
 *
 * Deliberately standalone. It touches nothing in app.js — it reads the open
 * dialog straight from the DOM (title, notes, platforms, languages), asks the
 * server for a caption, and writes the result into #fCaption. app.js's own
 * blur handler then saves it exactly as if it had been typed.
 *
 * So the whole integration is one <script> tag. No diff against app.js, no
 * schema change: the caption field already holds the hashtags too, which is
 * what its placeholder ("Caption and #hashtags") has always promised.
 *
 * If window.gzAI is missing — the Edge Function action not deployed yet — the
 * controls simply never appear and the studio behaves as it does today.
 */
(function () {
  "use strict";

  var LIMIT = { reel: 2200, carousel: 2200, story: 1000, fb: 2000, tiktok: 2200, shop: 500 };
  var LANGS = [
    { id: "en", name: "English" },
    { id: "manglish", name: "Manglish" },
    { id: "bm", name: "BM" },
    { id: "zh", name: "中文" }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var busy = false;

  function css() {
    if ($("gzAiCss")) return;
    var s = document.createElement("style");
    s.id = "gzAiCss";
    s.textContent =
      ".gzai{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 0}" +
      ".gzai select{border:1px solid var(--line);background:var(--bg,#fff);border-radius:999px;" +
        "padding:4px 9px;min-height:32px;font-size:12.5px;color:var(--ink-2)}" +
      ".gzai .steer{flex:1 1 180px;min-width:0;border:1px solid var(--line);background:var(--bg,#fff);" +
        "border-radius:999px;padding:5px 11px;min-height:32px;font-size:12.5px}" +
      ".gzai .steer:focus,.gzai select:focus{outline:none;border-color:var(--pink,#EC4E8E)}" +
      ".gzai-note{margin:5px 2px 0;font-size:12px;color:var(--ink-3);min-height:1.2em}" +
      ".gzai-note.bad{color:var(--danger,#C8314F)}" +
      ".gzai-note b{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink-2)}" +
      ".gzai-note b.over{color:var(--danger,#C8314F)}";
    document.head.appendChild(s);
  }

  /* Everything the caption needs is on screen already. */
  function context() {
    var plats = [].slice
      .call(document.querySelectorAll("#fPlatforms input:checked"))
      .map(function (i) { return i.value; })
      .filter(function (v) { return LIMIT[v]; });
    return {
      title: ($("fTitle") && $("fTitle").value.trim()) || "",
      notes: ($("fNotes") && $("fNotes").value.trim()) || "",
      platforms: plats,
      current: ($("fCaption") && $("fCaption").value.trim()) || ""
    };
  }

  function limitNow(plats) {
    if (!plats.length) return LIMIT.reel;
    return Math.min.apply(null, plats.map(function (p) { return LIMIT[p]; }));
  }

  function note(msg, bad) {
    var n = $("gzAiNote");
    if (!n) return;
    n.className = "gzai-note" + (bad ? " bad" : "");
    n.innerHTML = msg;
  }

  function count() {
    var cap = $("fCaption");
    if (!cap) return;
    var used = cap.value.length;
    var lim = limitNow(context().platforms);
    note("<b class='" + (used > lim ? "over" : "") + "'>" + used + " / " + lim + "</b> characters" +
         (used > lim ? " — too long for the tightest platform you picked" : ""));
  }

  /* The language the item is planned in, so the picker starts on the right one. */
  function defaultLang() {
    var checked = document.querySelector("#fLangs input:checked");
    if (checked && LANGS.some(function (l) { return l.id === checked.value; })) return checked.value;
    return "en";
  }

  function build() {
    var wrap = $("capWrap");
    if (!wrap || $("gzAiRow")) return;
    css();

    var row = document.createElement("div");
    row.className = "gzai";
    row.id = "gzAiRow";

    var sel = document.createElement("select");
    sel.id = "gzAiLang";
    sel.setAttribute("aria-label", "Caption language");
    sel.innerHTML = LANGS.map(function (l) {
      return '<option value="' + l.id + '">' + l.name + "</option>";
    }).join("");

    var steer = document.createElement("input");
    steer.type = "text";
    steer.className = "steer";
    steer.id = "gzAiSteer";
    steer.placeholder = "Optional: what should it lead with?";
    steer.setAttribute("aria-label", "Optional steer for the caption");
    steer.autocomplete = "off";

    var go = document.createElement("button");
    go.type = "button";
    go.className = "btn sm primary";
    go.id = "gzAiGo";
    go.textContent = "Write with AI";

    row.appendChild(sel);
    row.appendChild(steer);
    row.appendChild(go);

    var n = document.createElement("p");
    n.className = "gzai-note";
    n.id = "gzAiNote";

    wrap.appendChild(row);
    wrap.appendChild(n);

    go.addEventListener("click", run);
    steer.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); run(); }
    });
    var cap = $("fCaption");
    if (cap) cap.addEventListener("input", count);
  }

  function label() {
    var go = $("gzAiGo");
    if (!go) return;
    var has = ($("fCaption") && $("fCaption").value.trim()) !== "";
    go.textContent = busy ? "Writing…" : has ? "Rewrite with AI" : "Write with AI";
    go.disabled = busy;
  }

  async function run() {
    if (busy || !window.gzAI) return;
    var cap = $("fCaption");
    var ctx = context();

    if (!ctx.title) {
      note("Give the item a title first — that is what the caption is about.", true);
      var t = $("fTitle");
      if (t) t.focus();
      return;
    }

    busy = true;
    label();
    note("Writing…");

    try {
      var r = await window.gzAI.caption({
        title: ctx.title,
        notes: ctx.notes,
        platforms: ctx.platforms,
        lang: ($("gzAiLang") && $("gzAiLang").value) || "en",
        current: ctx.current,
        steer: ($("gzAiSteer") && $("gzAiSteer").value.trim()) || ""
      });

      cap.value = r.combined || r.caption || "";
      /* app.js saves the caption on blur; a dispatched blur is the same thing
         to its listener, so nothing here has to know how it persists. */
      cap.dispatchEvent(new FocusEvent("blur"));
      count();
      var steerBox = $("gzAiSteer");
      if (steerBox) steerBox.value = "";
    } catch (e) {
      note((e && e.message) || "Could not write the caption. Try again.", true);
    } finally {
      busy = false;
      label();
    }
  }

  /* The dialog is reused for every item, so refresh the defaults each time it
     opens rather than only once at load. */
  function onOpen() {
    build();
    var sel = $("gzAiLang");
    if (sel) sel.value = defaultLang();
    var steerBox = $("gzAiSteer");
    if (steerBox) steerBox.value = "";
    label();
    count();
  }

  function start() {
    if (!window.gzAI) return;   // action not deployed: stay invisible
    build();
    var dlg = $("dlg");
    if (!dlg) return;
    new MutationObserver(function () {
      if (dlg.open) setTimeout(onOpen, 0);
    }).observe(dlg, { attributes: true, attributeFilter: ["open"] });
    if (dlg.open) onOpen();
  }

  /* runtime.js loads this straight after app.js, once someone is signed in, so
     the DOM is long since ready and gzAI is already defined. Both are checked
     anyway, in case the file is ever pulled in from a plain <script> tag. */
  function boot() {
    if (window.gzAI) return start();
    var tries = 0;
    var t = setInterval(function () {
      if (window.gzAI) { clearInterval(t); start(); }
      else if (++tries > 100) clearInterval(t);   // ~20s, then give up quietly
    }, 200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

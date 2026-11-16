/* Gearizo Adjust: change the subtitles, 花字, stickers and images of a Claude-made video (an "edit" project),
   then have the Mac render it as the next version. Loaded on demand by app.js, which passes in what it needs
   (db, items, edits, myId, readOnly, toast, esc, who, fbFor, attHtml); draws with gzlayers.js (GZL). */
(function () {
  "use strict";
  const A = window.gzAdjust = {};
  let db, items, edits, myId, readOnly, toast, esc, who, fbFor, attHtml;
  const $a = (id) => document.getElementById(id);
  let dlg = null, itemId = null, doc = null, sel = null, k = 1, raf = 0, saveT = null, savedAt = 0, saving = false;
  let hist = [], fut = [], pending = null, tab = "layer", pxs = 40, linkSubs = true;
  const ROWS = [{ id: "sub", name: "字幕 Subtitles" }, { id: "text", name: "花字 Text" }, { id: "media", name: "素材 Stickers & images" }];
  const rowOf = (L) => (L.kind === "image" || L.kind === "sticker") ? "media" : L.group === "sub" ? "sub" : "text";
  const r2 = (n) => Math.round(n * 100) / 100;
  const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
  const cur = () => doc && doc.layers.find((L) => L.id === sel);
  const now = () => { const v = $a("adjVid"); return v ? v.currentTime || 0 : 0; };

  const STYLE = `
dialog.adj{width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--bg);color:var(--ink);overflow:hidden}
dialog.adj::backdrop{background:rgba(0,0,0,.4)}
.adj-wrap{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%}
.adj-top{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface);flex-wrap:wrap}
.adj-title{display:flex;flex-direction:column;min-width:0;flex:1 1 200px}
.adj-title b{font-family:var(--display);font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.adj-title span{font-size:12px;color:var(--ink-3)}
.adj-rs{font-size:12.5px;color:var(--ink-2);max-width:340px}
.adj-rs.err{color:var(--danger)} .adj-rs.ok{color:var(--ready)}
.adj-body{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0}
.adj-left{display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0;background:#1B1D20}
.adj-view{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;overflow:hidden}
.adj-box{position:relative;flex:none}
.adj-stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;background:#000}
.adj-stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
.adj-layers{position:absolute;inset:0;cursor:default}
.adj-layers .gzl{cursor:move;touch-action:none}
.adj-guide{position:absolute;background:#EC4E8E;pointer-events:none;display:none;z-index:5}
.adj-guide.v{top:0;bottom:0;width:1px;left:50%} .adj-guide.h{left:0;right:0;height:1px;top:50%}
.adj-sel{position:absolute;border:1.5px solid #4FC3F7;pointer-events:none;z-index:6;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.adj-sel i{position:absolute;right:-8px;bottom:-8px;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #4FC3F7;pointer-events:auto;cursor:nwse-resize;touch-action:none}
.adj-ctl{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#24272B;color:#E9ECEF}
.adj-ctl input[type=range]{flex:1;accent-color:#EC4E8E}
.adj-ctl .t{font-variant-numeric:tabular-nums;font-size:13px;min-width:92px}
.adj-ctl .btn{min-height:32px}
.adj-side{border-left:1px solid var(--line);background:var(--surface);overflow:auto;min-height:0}
.adj-tabs{display:flex;gap:4px;padding:10px 12px 0;position:sticky;top:0;background:var(--surface);z-index:1}
.adj-tabs button{border:0;background:none;padding:8px 10px;border-radius:8px 8px 0 0;font-weight:600;color:var(--ink-3);cursor:pointer}
.adj-tabs button[aria-selected=true]{color:var(--ink);box-shadow:inset 0 -2px 0 var(--pink)}
.adj-pan{padding:12px 14px 20px;display:flex;flex-direction:column;gap:12px}
.adj-pan h4{margin:6px 0 0;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.adj-f{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:center;gap:6px 10px;font-size:13px}
.adj-f>span{color:var(--ink-2)}
.adj-f .in{display:flex;align-items:center;gap:6px;min-width:0}
.adj-f input[type=range]{flex:1;min-width:0;accent-color:var(--pink)}
.adj-f input[type=number]{width:72px;border:1px solid var(--line);border-radius:8px;padding:4px 6px;font:inherit}
.adj-f input[type=color]{width:34px;height:28px;border:1px solid var(--line);border-radius:8px;padding:1px;background:#fff}
.adj-f select{border:1px solid var(--line);border-radius:8px;padding:5px 6px;font:inherit;min-width:0;flex:1}
.adj-pan textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;font-size:15px;min-height:64px;resize:vertical}
.adj-pan .row{display:flex;gap:6px;flex-wrap:wrap}
.adj-pan .hint{font-size:12.5px;color:var(--ink-3);margin:0}
.adj-pan label.chk{display:flex;gap:8px;align-items:center;font-size:13px;background:var(--sunk);padding:8px 10px;border-radius:10px}
.adj-list button{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:none;padding:6px 8px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px}
.adj-list button:hover{background:var(--sunk)}
.adj-list .tm{font-variant-numeric:tabular-nums;color:var(--ink-3);font-size:12px;flex:none;width:44px}
.adj-list .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.adj-fb{background:var(--sunk);border-radius:12px;padding:10px 12px;font-size:13.5px}
.adj-fb.done{opacity:.55}
.adj-fb .meta{font-size:12px;color:var(--ink-3);margin-top:4px}
.adj-fb button.tc{border:0;background:var(--pink);color:#fff;border-radius:999px;padding:2px 9px;font-weight:700;font-size:12px;cursor:pointer;margin-right:6px}
.adj-tl{border-top:1px solid var(--line);background:var(--surface);padding:6px 0 8px;user-select:none}
.adj-tlbar{display:flex;align-items:center;gap:8px;padding:0 12px 6px;font-size:12px;color:var(--ink-3)}
.adj-tlbar .btn{min-height:26px;padding:2px 9px}
.adj-tlsc{display:grid;grid-template-columns:120px minmax(0,1fr)}
.adj-tlnames div{height:30px;display:flex;align-items:center;padding-left:12px;font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden}
.adj-tlx{overflow-x:auto;overflow-y:hidden;position:relative}
.adj-tlin{position:relative}
.adj-tlrow{position:relative;height:30px;border-bottom:1px dashed var(--line)}
.adj-blk{position:absolute;top:3px;height:24px;border-radius:6px;background:color-mix(in srgb,var(--c) 22%,#fff);border:1px solid var(--c);font-size:11.5px;line-height:22px;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:grab;box-sizing:border-box;touch-action:none}
.adj-blk.on{background:var(--c);color:#fff}
.adj-blk i{position:absolute;top:0;bottom:0;width:7px;cursor:ew-resize}
.adj-blk i.l{left:0} .adj-blk i.r{right:0}
.adj-ph{position:absolute;top:0;bottom:0;width:2px;background:var(--pink);pointer-events:none;z-index:2}
@media (max-width:900px){.adj-body{grid-template-columns:1fr;grid-template-rows:minmax(260px,55vh) auto;overflow:auto}.adj-side{border-left:0;border-top:1px solid var(--line)}.adj-tlsc{grid-template-columns:70px minmax(0,1fr)}}
`;

  function ensureDom() {
    if (dlg) return;
    const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
    const fl = document.createElement("link"); fl.rel = "stylesheet"; fl.href = GZL.fontsHref(); document.head.appendChild(fl);
    dlg = document.createElement("dialog"); dlg.className = "adj"; dlg.setAttribute("aria-label", "Adjust video");
    dlg.innerHTML = '<div class="adj-wrap"><div class="adj-top">' +
      '<button class="btn ghost sm" type="button" data-a="close" aria-label="Close">✕</button>' +
      '<div class="adj-title"><b id="adjTitle"></b><span id="adjSaved">Saved</span></div>' +
      '<button class="btn sm" type="button" data-a="undo" title="Undo (⌘Z)" aria-label="Undo">↶</button><button class="btn sm" type="button" data-a="redo" title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>' +
      '<span class="adj-rs" id="adjRs"></span><button class="btn primary sm" type="button" data-a="render" id="adjRender">Render new version</button></div>' +
      '<div class="adj-body"><div class="adj-left"><div class="adj-view" id="adjView"><div class="adj-box" id="adjBox"><div class="adj-stage" id="adjStage">' +
      '<video id="adjVid" playsinline preload="auto"></video><div class="adj-layers" id="adjLayers"></div><div class="adj-guide v" id="adjGv"></div><div class="adj-guide h" id="adjGh"></div></div>' +
      '<div class="adj-sel" id="adjSel" hidden><i id="adjHandle" title="Drag to resize"></i></div></div></div>' +
      '<div class="adj-ctl"><button class="btn sm" type="button" data-a="play" id="adjPlay" aria-label="Play">▶</button><span class="t" id="adjTime">0:00.0</span>' +
      '<input type="range" id="adjScrub" min="0" step="0.01" value="0" aria-label="Time"><button class="btn sm" type="button" data-a="addtext">+ Text</button></div></div>' +
      '<aside class="adj-side"><div class="adj-tabs" role="tablist"><button type="button" role="tab" data-tab="layer">Layer</button><button type="button" role="tab" data-tab="fb">Feedback <span id="adjFbN"></span></button></div><div class="adj-pan" id="adjPan"></div></aside></div>' +
      '<div class="adj-tl"><div class="adj-tlbar"><span>Timeline · drag a block to move it, its edges to trim</span><span style="flex:1"></span><button class="btn sm" type="button" data-a="zout" aria-label="Zoom out">−</button><button class="btn sm" type="button" data-a="zin" aria-label="Zoom in">+</button></div>' +
      '<div class="adj-tlsc"><div class="adj-tlnames" id="adjTlNames"></div><div class="adj-tlx" id="adjTlx"><div class="adj-tlin" id="adjTlin"></div></div></div></div></div>';
    document.body.appendChild(dlg);
    wire();
  }

  /* ---------- open / close / save ---------- */
  A.open = function (id, ctx) {
    ({ db, items, edits, myId, readOnly, toast, esc, who, fbFor, attHtml } = ctx);
    const d = edits.get(id);
    if (!d) { toast("This video has no adjustable project."); return; }
    ensureDom();
    itemId = id; doc = JSON.parse(JSON.stringify(d)); doc.layers = Array.isArray(doc.layers) ? doc.layers : [];
    doc.layers.forEach((L, i) => { if (!L.id) L.id = "L" + i + "-" + Math.random().toString(36).slice(2, 6); });
    sel = null; hist = []; fut = []; pending = null; tab = "layer";
    const it = items.get(id);
    $a("adjTitle").textContent = "Adjust · " + (it ? (it.code ? it.code + " " : "") + it.title : "video");
    const v = $a("adjVid");
    v.pause(); v.removeAttribute("src"); v.load();
    v.setAttribute("src", (doc.base && doc.base.url) || "");
    $a("adjScrub").max = String(doc.dur || 1);
    const stage = $a("adjStage"); stage.style.width = doc.w + "px"; stage.style.height = doc.h + "px";
    const lay = $a("adjLayers"); lay.innerHTML = ""; lay._gzl = null;
    if (!dlg.open) dlg.showModal();
    fit(); pxs = Math.max(8, ($a("adjTlx").clientWidth - 20) / Math.max(1, doc.dur || 1));
    renderStatus(); panel(); timeline(); draw();
  };
  A.isOpen = () => !!(dlg && dlg.open);
  A.remote = function (id, d) {           // a new copy arrived from the database
    if (!A.isOpen() || id !== itemId || !d) return;
    doc.render = d.render; renderStatus();
    if (d.updatedBy !== myId && (d.updatedAt || 0) > savedAt && !saveT && !saving && !pending) {
      doc.layers = JSON.parse(JSON.stringify(d.layers || [])); doc.rev = d.rev; savedAt = d.updatedAt || 0;
      if (sel && !cur()) sel = null; panel(); timeline(); draw();
    }
  };
  function close() { flush(); stop(); $a("adjVid").pause(); dlg.close(); }
  function changed() {
    $a("adjSaved").textContent = "Saving…";
    clearTimeout(saveT); saveT = setTimeout(flush, 900);
  }
  async function flush() {
    if (!saveT) return; clearTimeout(saveT); saveT = null;
    if (!db || readOnly) { $a("adjSaved").textContent = "Not saved (read only)"; return; }
    saving = true;
    const t = Date.now();
    try {
      await db.collection("edits").doc(itemId).update({ layers: doc.layers, rev: (doc.rev || 0) + 1, updatedAt: t, updatedBy: myId || "" });
      doc.rev = (doc.rev || 0) + 1; savedAt = t; $a("adjSaved").textContent = "Saved";
    } catch (e) { $a("adjSaved").textContent = "Couldn’t save. Check your connection."; }
    saving = false;
  }

  /* ---------- history ---------- */
  const snap = () => JSON.stringify(doc.layers);
  function mark() { hist.push(snap()); if (hist.length > 120) hist.shift(); fut = []; }
  function begin() { if (!pending) pending = snap(); }
  function commit() { if (pending) { hist.push(pending); if (hist.length > 120) hist.shift(); fut = []; pending = null; } }
  function undo() { commit(); if (!hist.length) return; fut.push(snap()); doc.layers = JSON.parse(hist.pop()); after(); }
  function redo() { if (!fut.length) return; hist.push(snap()); doc.layers = JSON.parse(fut.pop()); after(); }
  function after() { if (sel && !cur()) sel = null; panel(); timeline(); draw(); changed(); }

  /* ---------- drawing ---------- */
  function fit() {
    const view = $a("adjView"), box = $a("adjBox");
    const W = view.clientWidth - 24, H = view.clientHeight - 24;
    k = Math.max(0.05, Math.min(W / doc.w, H / doc.h));
    box.style.width = doc.w * k + "px"; box.style.height = doc.h * k + "px";
    $a("adjStage").style.transform = "scale(" + k + ")";
    draw();
  }
  function draw() {
    if (!doc) return;
    const t = now();
    GZL.render($a("adjLayers"), doc, t, {});
    $a("adjTime").textContent = fmt(t) + " / " + fmt(doc.dur);
    if (document.activeElement !== $a("adjScrub")) $a("adjScrub").value = String(t);
    const ph = $a("adjPh"); if (ph) ph.style.left = t * pxs + "px";
    selBox();
  }
  function selBox() {
    const box = $a("adjSel"), L = cur();
    const el = L && $a("adjLayers").querySelector('.gzl[data-id="' + CSS.escape(L.id) + '"]');
    if (!el || el.style.display === "none") { box.hidden = true; return; }
    const r = el.getBoundingClientRect(), b = $a("adjBox").getBoundingClientRect();
    box.hidden = false;
    box.style.left = r.left - b.left - 3 + "px"; box.style.top = r.top - b.top - 3 + "px";
    box.style.width = r.width + 6 + "px"; box.style.height = r.height + 6 + "px";
  }
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  function play() { const v = $a("adjVid"); if (v.paused) { v.play().catch(() => {}); } else v.pause(); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function seek(t) { const v = $a("adjVid"); v.currentTime = Math.max(0, Math.min(doc.dur || 0, t)); draw(); }

  /* ---------- selecting and changing layers ---------- */
  function select(id, jump) {
    commit(); sel = id; tab = "layer"; panel(); timeline();
    const L = cur();
    if (L && jump) { const t = now(); if (t < L.start || t >= L.end) seek(L.start + Math.min(0.3, (L.end - L.start) / 2)); }
    draw();
  }
  const targets = (L, key) => (linkSubs && L.group === "sub" && (/^style\./.test(key) || ["x", "y", "s", "rot", "anim.in", "anim.out"].includes(key)))
    ? doc.layers.filter((x) => x.group === "sub") : [L];
  function setPath(o, key, val) { const p = key.split("."); let x = o; for (let i = 0; i < p.length - 1; i++) { x[p[i]] = x[p[i]] && typeof x[p[i]] === "object" ? x[p[i]] : {}; x = x[p[i]]; } x[p[p.length - 1]] = val; }
  function getPath(o, key) { return key.split(".").reduce((x, p) => x == null ? undefined : x[p], o); }
  function setVal(key, val) {
    const L = cur(); if (!L) return;
    targets(L, key).forEach((x) => setPath(x, key, val));
    if (key === "start" || key === "end") { L.start = r2(Math.max(0, Math.min(L.start, doc.dur - 0.1))); L.end = r2(Math.max(L.start + 0.1, Math.min(L.end, doc.dur))); timeline(); }
    draw(); changed();
  }
  function addText() {
    mark();
    const t = now(), L = { id: "t" + Date.now().toString(36), kind: "text", group: "", name: "", text: "新的花字", x: Math.round(doc.w / 2), y: Math.round(doc.h * 0.35), s: 1, rot: 0,
      start: r2(t), end: r2(Math.min(doc.dur, t + 3)), anim: { in: "pop", out: "fade" },
      style: { font: "huangyou", size: Math.round(doc.w / 11), weight: 900, color: "#FFE14D", stroke: "#1C1C1C", strokeW: Math.round(doc.w / 180), shadowA: 0.35 } };
    doc.layers.push(L); sel = L.id; panel(); timeline(); seek(L.start + Math.min(0.3, (L.end - L.start) / 2)); changed();
    setTimeout(() => { const ta = $a("adjPan").querySelector("textarea"); if (ta) { ta.focus(); ta.select(); } }, 30);
  }
  function del() { const L = cur(); if (!L) return; mark(); doc.layers = doc.layers.filter((x) => x !== L); sel = null; after(); }
  function dup() {
    const L = cur(); if (!L) return; mark();
    const c = JSON.parse(JSON.stringify(L)); c.id = "c" + Date.now().toString(36); c.x += 30; c.y += 30;
    doc.layers.splice(doc.layers.indexOf(L) + 1, 0, c); sel = c.id; after();
  }
  function order(dir) {
    const L = cur(); if (!L) return; mark();
    const i = doc.layers.indexOf(L), j = dir > 0 ? doc.layers.length - 1 : 0;
    doc.layers.splice(i, 1); doc.layers.splice(j, 0, L); after();
  }

  /* ---------- side panel ---------- */
  const opt = (v, cur, label) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + esc(label) + "</option>";
  function field(label, inner) { return '<div class="adj-f"><span>' + label + '</span><div class="in">' + inner + "</div></div>"; }
  function rng(key, val, min, max, step) { return '<input type="range" data-k="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><input type="number" data-k="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">'; }
  function col(key, val) { return '<input type="color" data-k="' + key + '" value="' + esc(val) + '">'; }
  function panel() {
    const pan = $a("adjPan"); if (!pan) return;
    dlg.querySelectorAll(".adj-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const fbs = (typeof fbFor === "function" ? fbFor(itemId) : []), open = fbs.filter((f) => !f.done).length;
    $a("adjFbN").textContent = open ? "(" + open + ")" : "";
    if (tab === "fb") {
      pan.innerHTML = fbs.length ? fbs.map((f) => '<div class="adj-fb' + (f.done ? " done" : "") + '">' +
        (f.t != null ? '<button type="button" class="tc" data-seek="' + f.t + '">' + fmt(f.t).replace(/\.\d$/, "") + (f.t2 != null ? "–" + fmt(f.t2).replace(/\.\d$/, "") : "") + "</button>" : "") +
        esc(f.text || "") + (f.files && f.files.length && typeof attHtml === "function" ? attHtml(f.files) : "") +
        '<div class="meta">' + esc(who(f.by)) + " · v" + (f.version || "?") + (f.done ? " · fixed" : "") + "</div></div>").join("") : '<p class="hint">No feedback on this video yet.</p>';
      return;
    }
    const L = cur();
    if (!L) {
      const t = now(), vis = doc.layers.filter((x) => t >= x.start && t < x.end);
      const list = (arr) => '<div class="adj-list">' + arr.map((x) => '<button type="button" data-pick="' + esc(x.id) + '"><span class="tm">' + fmt(x.start).replace(/\.\d$/, "") + '</span><span class="nm">' + esc(x.kind === "text" ? x.text : (x.name || x.kind)) + "</span></button>").join("") + "</div>";
      pan.innerHTML = '<p class="hint">Tap something on the video, or a block on the timeline, to change it. Drag it to move it; drag the round handle to resize.</p>' +
        (vis.length ? "<h4>On screen now</h4>" + list(vis) : "") +
        '<h4>Everything (' + doc.layers.length + ")</h4>" + list(doc.layers.slice().sort((a, b) => a.start - b.start)) +
        '<p class="hint">Keys: Space play · ←↑→↓ nudge · ⌘Z undo · ⌘D duplicate · Delete remove</p>';
      return;
    }
    const s = GZL.style(L), an = L.anim || {}, isText = L.kind === "text", sub = L.group === "sub";
    let h = "";
    if (isText) h += '<textarea data-k="text" aria-label="Text">' + esc(L.text || "") + "</textarea>";
    else h += '<p class="hint"><b>' + esc(L.name || (L.kind === "sticker" ? "Sticker" : "Image")) + "</b>" + (L.kind === "sticker" ? " · moves in the final video; here you see a still" : "") + "</p>";
    if (sub) h += '<label class="chk"><input type="checkbox" id="adjLink"' + (linkSubs ? " checked" : "") + "> Style and position change all subtitles together</label>";
    if (isText) {
      h += "<h4>Font</h4>" +
        field("Font", '<select data-k="style.font">' + GZL.FONTS.map((f) => opt(f.id, s.font, f.name)).join("") + "</select>") +
        field("Weight", '<select data-k="style.weight" data-num="1">' + opt(400, s.weight, "Regular") + opt(500, s.weight, "Medium") + opt(700, s.weight, "Bold") + opt(900, s.weight, "Black") + '</select><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-k="style.italic"' + (s.italic ? " checked" : "") + ">Italic</label>") +
        field("Size", rng("style.size", s.size, 12, 300, 1)) +
        field("Colour", col("style.color", s.color)) +
        field("Spacing", rng("style.ls", s.ls, -10, 40, 1)) +
        field("Wrap width", rng("style.maxW", s.maxW, 0, doc.w, 10)) +
        "<h4>Outline</h4>" + field("Colour", col("style.stroke", s.stroke)) + field("Thickness", rng("style.strokeW", s.strokeW, 0, 40, 1)) +
        "<h4>Box behind</h4>" + field("Colour", col("style.bg", s.bg)) + field("Opacity", rng("style.bgA", s.bgA, 0, 1, 0.05)) + field("Corners", rng("style.radius", s.radius, 0, 80, 1)) + field("Padding", rng("style.pad", s.pad, 0, 60, 1));
    } else h += "<h4>Size</h4>" + field("Width", rng("w", L.w || 300, 20, doc.w * 2, 2));
    h += "<h4>Shadow</h4>" + field("Colour", col("style.shadow", s.shadow)) + field("Strength", rng("style.shadowA", s.shadowA, 0, 1, 0.05)) + field("Blur", rng("style.shadowBlur", s.shadowBlur, 0, 60, 1)) + field("Drop", rng("style.shadowY", s.shadowY, -40, 40, 1));
    h += "<h4>Place</h4>" + field("X", '<input type="number" data-k="x" step="1" value="' + Math.round(L.x) + '"><button class="btn sm ghost" type="button" data-a="centre">Centre</button>') +
      field("Y", '<input type="number" data-k="y" step="1" value="' + Math.round(L.y) + '">') +
      field("Scale", rng("s", r2(L.s || 1), 0.1, 5, 0.01)) + field("Rotate", rng("rot", Math.round(L.rot || 0), -180, 180, 1));
    h += "<h4>Timing</h4>" + field("Starts", '<input type="number" data-k="start" step="0.05" min="0" value="' + r2(L.start) + '"><button class="btn sm ghost" type="button" data-a="setstart">Now</button>') +
      field("Ends", '<input type="number" data-k="end" step="0.05" min="0" value="' + r2(L.end) + '"><button class="btn sm ghost" type="button" data-a="setend">Now</button>') +
      field("Comes in", '<select data-k="anim.in">' + opt("none", an.in || "none", "Just appears") + opt("pop", an.in, "Pop") + opt("fade", an.in, "Fade") + opt("up", an.in, "Slide up") + "</select>") +
      field("Goes out", '<select data-k="anim.out">' + opt("none", an.out || "none", "Just disappears") + opt("fade", an.out, "Fade") + "</select>");
    h += '<div class="row"><button class="btn sm" type="button" data-a="dup">Duplicate</button><button class="btn sm" type="button" data-a="front">To front</button><button class="btn sm" type="button" data-a="back">To back</button><button class="btn sm ghost danger" type="button" data-a="del">Remove</button><button class="btn sm ghost" type="button" data-a="desel">Done</button></div>';
    pan.innerHTML = h;
  }
  function syncFields() { const L = cur(); if (!L) return; $a("adjPan").querySelectorAll('[data-k="x"],[data-k="y"],[data-k="s"],[data-k="start"],[data-k="end"]').forEach((i) => { if (document.activeElement === i) return; const v = getPath(L, i.dataset.k); i.value = i.dataset.k === "x" || i.dataset.k === "y" ? Math.round(v || 0) : r2(v == null ? (i.dataset.k === "s" ? 1 : 0) : v); }); }

  /* ---------- timeline ---------- */
  function lanes(list) {
    const ends = [], out = new Map();
    list.slice().sort((a, b) => a.start - b.start).forEach((L) => { let i = ends.findIndex((e) => e <= L.start + 0.001); if (i < 0) { i = ends.length; ends.push(0); } ends[i] = L.end; out.set(L.id, i); });
    return { n: Math.max(1, ends.length), of: out };
  }
  function timeline() {
    if (!doc) return;
    const names = $a("adjTlNames"), tin = $a("adjTlin"), W = Math.max(1, doc.dur) * pxs;
    let nh = "", th = "";
    const C = { sub: "#4A6159", text: "#EC4E8E", media: "#E8772E" };
    ROWS.forEach((row) => {
      const list = doc.layers.filter((L) => rowOf(L) === row.id), ln = lanes(list);
      for (let i = 0; i < ln.n; i++) {
        nh += "<div>" + (i ? "" : esc(row.name)) + "</div>";
        th += '<div class="adj-tlrow" style="width:' + W + 'px">' + list.filter((L) => ln.of.get(L.id) === i).map((L) =>
          '<div class="adj-blk' + (L.id === sel ? " on" : "") + '" data-blk="' + esc(L.id) + '" style="--c:' + C[row.id] + ";left:" + L.start * pxs + "px;width:" + Math.max(6, (L.end - L.start) * pxs) + 'px" title="' + esc((L.kind === "text" ? L.text : L.name || L.kind) + " · " + fmt(L.start) + "–" + fmt(L.end)) + '"><i class="l"></i>' + esc(L.kind === "text" ? L.text : (L.name || L.kind)) + '<i class="r"></i></div>').join("") + "</div>";
      }
    });
    names.innerHTML = nh;
    tin.style.width = W + "px";
    tin.innerHTML = th + '<div class="adj-ph" id="adjPh"></div>';
    draw();
  }

  /* ---------- wiring ---------- */
  function wire() {
    const v = $a("adjVid");
    v.addEventListener("play", () => { $a("adjPlay").textContent = "❚❚"; if (!raf) loop(); });
    v.addEventListener("pause", () => { $a("adjPlay").textContent = "▶"; stop(); draw(); if (!cur()) panel(); });
    v.addEventListener("seeked", () => { draw(); if (!cur() && tab === "layer") panel(); });
    v.addEventListener("loadedmetadata", draw);
    v.addEventListener("error", () => { $a("adjRs").textContent = "The preview video couldn’t load. You can still adjust; the Mac uses the full video."; $a("adjRs").className = "adj-rs err"; });
    $a("adjScrub").addEventListener("input", (e) => seek(Number(e.target.value)));
    new ResizeObserver(() => { if (dlg.open) fit(); }).observe($a("adjView"));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (sel) { select(null); } else close(); });
    dlg.addEventListener("close", () => { flush(); stop(); });

    dlg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      const tb = e.target.closest("[data-tab]");
      if (tb) { commit(); tab = tb.dataset.tab; panel(); return; }
      const pk = e.target.closest("[data-pick]"); if (pk) { select(pk.dataset.pick, true); return; }
      const sk = e.target.closest("[data-seek]"); if (sk) { seek(Number(sk.dataset.seek)); return; }
      if (!b) return;
      const a = b.dataset.a, L = cur();
      if (a === "close") close();
      else if (a === "play") play();
      else if (a === "undo") undo();
      else if (a === "redo") redo();
      else if (a === "addtext") addText();
      else if (a === "del") del();
      else if (a === "dup") dup();
      else if (a === "front") order(1);
      else if (a === "back") order(-1);
      else if (a === "desel") select(null);
      else if (a === "zin" || a === "zout") { pxs = Math.max(4, Math.min(400, pxs * (a === "zin" ? 1.5 : 1 / 1.5))); timeline(); }
      else if (a === "centre" && L) { mark(); setVal("x", Math.round(doc.w / 2)); syncFields(); }
      else if (a === "setstart" && L) { mark(); setVal("start", r2(now())); syncFields(); }
      else if (a === "setend" && L) { mark(); setVal("end", r2(now())); syncFields(); }
      else if (a === "render") requestRender();
    });

    const pan = $a("adjPan");
    pan.addEventListener("input", (e) => {
      const i = e.target; if (i.id === "adjLink") return;
      const key = i.dataset.k; if (!key) return;
      begin();
      let val = i.type === "checkbox" ? i.checked : i.value;
      if (i.type === "range" || i.type === "number" || i.dataset.num) { val = Number(val); if (!isFinite(val)) return; }
      setVal(key, val);
      pan.querySelectorAll('[data-k="' + key + '"]').forEach((o) => { if (o !== i && o.type !== "checkbox") o.value = String(val); });
      if (key === "text") timeline();
    });
    pan.addEventListener("change", (e) => { if (e.target.id === "adjLink") { linkSubs = e.target.checked; return; } commit(); });
    pan.addEventListener("focusout", commit);

    // dragging on the video
    const lay = $a("adjLayers");
    let drag = null;
    const toVideo = (e) => { const b = $a("adjBox").getBoundingClientRect(); return { x: (e.clientX - b.left) / k, y: (e.clientY - b.top) / k }; };
    lay.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(".gzl");
      if (!el) { if (sel) select(null); return; }
      e.preventDefault();
      if (el.dataset.id !== sel) select(el.dataset.id);
      const L = cur(); if (!L) return;
      const p = toVideo(e);
      drag = { mode: "move", id: L.id, px: p.x, py: p.y, x0: L.x, y0: L.y, snap: snap(), moved: false };
      lay.setPointerCapture(e.pointerId);
    });
    $a("adjHandle").addEventListener("pointerdown", (e) => {
      const L = cur(); if (!L) return; e.preventDefault(); e.stopPropagation();
      const p = toVideo(e);
      drag = { mode: "scale", id: L.id, d0: Math.hypot(p.x - L.x, p.y - L.y) || 1, s0: L.s || 1, snap: snap(), moved: false };
      $a("adjHandle").setPointerCapture(e.pointerId);
    });
    const onMove = (e) => {
      if (!drag) return;
      const L = cur(); if (!L) return;
      const p = toVideo(e);
      if (drag.mode === "move") {
        let x = drag.x0 + (p.x - drag.px), y = drag.y0 + (p.y - drag.py);
        const th = 8 / k, sx = Math.abs(x - doc.w / 2) < th, sy = Math.abs(y - doc.h / 2) < th;
        if (sx) x = doc.w / 2; if (sy) y = doc.h / 2;
        $a("adjGv").style.display = sx ? "block" : "none"; $a("adjGh").style.display = sy ? "block" : "none";
        const dx = Math.round(x) - L.x, dy = Math.round(y) - L.y;
        if (dx || dy) { drag.moved = true; targets(L, "x").forEach((o) => { o.x = Math.round(o.x + dx); o.y = Math.round(o.y + dy); }); }
      } else {
        const s = Math.max(0.1, Math.min(8, drag.s0 * Math.hypot(p.x - L.x, p.y - L.y) / drag.d0));
        drag.moved = true; targets(L, "s").forEach((o) => { o.s = r2(s); });
      }
      draw(); syncFields();
    };
    const onUp = () => {
      if (!drag) return;
      $a("adjGv").style.display = $a("adjGh").style.display = "none";
      if (drag.moved) { hist.push(drag.snap); fut = []; changed(); }
      drag = null;
    };
    lay.addEventListener("pointermove", onMove); lay.addEventListener("pointerup", onUp); lay.addEventListener("pointercancel", onUp);
    $a("adjHandle").addEventListener("pointermove", onMove); $a("adjHandle").addEventListener("pointerup", onUp);
    lay.addEventListener("dblclick", (e) => { const el = e.target.closest(".gzl"); if (el) { select(el.dataset.id); const ta = $a("adjPan").querySelector("textarea"); if (ta) ta.focus(); } });

    // timeline: click to seek, drag blocks to move/trim
    const tlx = $a("adjTlx"); let td = null;
    tlx.addEventListener("pointerdown", (e) => {
      const blk = e.target.closest(".adj-blk"), r = $a("adjTlin").getBoundingClientRect(), t = (e.clientX - r.left) / pxs;
      if (!blk) { seek(t); return; }
      e.preventDefault();
      const id = blk.dataset.blk; if (id !== sel) select(id);
      const L = cur(); if (!L) return;
      td = { L, t0: t, s0: L.start, e0: L.end, mode: e.target.classList.contains("l") ? "l" : e.target.classList.contains("r") ? "r" : "m", snap: snap(), moved: false, blk };
      tlx.setPointerCapture(e.pointerId);
    });
    tlx.addEventListener("pointermove", (e) => {
      if (!td) return;
      const r = $a("adjTlin").getBoundingClientRect(), d = Math.round(((e.clientX - r.left) / pxs - td.t0) * 20) / 20, L = td.L, len = td.e0 - td.s0;
      if (td.mode === "m") { L.start = r2(Math.max(0, Math.min(doc.dur - len, td.s0 + d))); L.end = r2(L.start + len); }
      else if (td.mode === "l") L.start = r2(Math.max(0, Math.min(td.e0 - 0.1, td.s0 + d)));
      else L.end = r2(Math.max(td.s0 + 0.1, Math.min(doc.dur, td.e0 + d)));
      td.moved = true;
      td.blk.style.left = L.start * pxs + "px"; td.blk.style.width = Math.max(6, (L.end - L.start) * pxs) + "px";
      seek(td.mode === "r" ? L.end - 0.04 : L.start + Math.min(0.3, (L.end - L.start) / 2)); syncFields();
    });
    const tUp = () => { if (!td) return; if (td.moved) { hist.push(td.snap); fut = []; changed(); timeline(); } td = null; };
    tlx.addEventListener("pointerup", tUp); tlx.addEventListener("pointercancel", tUp);

    dlg.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range" && e.target.type !== "checkbox";
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (typing) return;
      if (e.key === " ") { e.preventDefault(); play(); return; }
      const L = cur(); if (!L) return;
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); dup(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); return; }
      const m = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (m) { e.preventDefault(); begin(); const n = e.shiftKey ? 10 : 2; targets(L, "x").forEach((o) => { o.x += m[0] * n; o.y += m[1] * n; }); draw(); syncFields(); changed(); clearTimeout(A._kt); A._kt = setTimeout(commit, 600); }
    });
  }

  /* ---------- render on the Mac ---------- */
  function renderStatus() {
    const r = (doc && doc.render) || {}, el = $a("adjRs"), btn = $a("adjRender");
    const busy = r.state === "queued" || r.state === "rendering";
    btn.disabled = busy || readOnly;
    el.className = "adj-rs" + (r.state === "failed" ? " err" : r.state === "done" ? " ok" : "");
    el.textContent = r.state === "queued" ? "Waiting for the Mac (it checks every 3 minutes)…" : r.state === "rendering" ? "Rendering on the Mac…" :
      r.state === "done" ? "v" + r.n + " sent for review ✓" : r.state === "failed" ? "Render failed: " + (r.error || "unknown") : "";
  }
  async function requestRender() {
    if (!db || readOnly) return;
    commit(); saveT = saveT || 1; await flush();
    try {
      await db.collection("edits").doc(itemId).update({ render: { state: "queued", req: Date.now(), by: myId || "", rev: doc.rev || 0 } });
      doc.render = { state: "queued" }; renderStatus();
      toast("Sent to the Mac. The new version shows up in Review when it’s done.");
    } catch (e) { toast("Couldn’t ask for the render. Check your connection."); }
  }
})();

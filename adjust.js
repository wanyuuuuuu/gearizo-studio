/* Gearizo Adjust: change the subtitles, 花字, stickers and images of a Claude-made video (an "edit" project),
   then have the Mac render it as the next version. Loaded on demand by app.js, which passes in what it needs
   (db, items, edits, myId, readOnly, toast, esc, who, fbFor, attHtml); draws with gzlayers.js (GZL). */
(function () {
  "use strict";
  const A = window.gzAdjust = {};
  let db, items, edits, myId, readOnly, toast, esc, who, fbFor, attHtml, assets, typeFor;
  /* film mode: an animated video made of gzscenes.js templates (doc.film) instead of a filmed base video */
  let FM = false, ft = 0, playing = false, playT0 = 0, sc = null, music = null, part = null, sfxFiles = null, fxSel = null;
  const SDEF = {
    hook: { kicker: "", title: "New *title*", sub: "", icon: "sparkle" },
    iconText: { tag: "", icon: "sparkle", title: "Title", text: "Short explanation" },
    lens: { heading: "", band: "MICHELIN 205/55 R16 91V", word: "91V", label: "*91V* = load & speed", text: "" },
    compare: { heading: "", left: { icon: "check", title: "Do", text: "", mark: "yes" }, right: { icon: "cross", title: "Don't", text: "", mark: "no" } },
    steps: { heading: "How to", steps: [{ icon: "", text: "Step one" }, { icon: "", text: "Step two" }, { icon: "", text: "Step three" }] },
    stop: { heading: "Stop if:", items: ["First sign", "Second sign"] },
    endcard: { image: "", title: "*Tagline*", sub: "", cta: "SAVE & SHARE", icon: "box" }
  };
  const SFIELDS = {
    hook: [["kicker", "Label"], ["title", "Title (*star* a word)"], ["sub", "Line under"], ["icon", "Icon", "icon"]],
    iconText: [["tag", "Label"], ["icon", "Icon", "icon"], ["title", "Title"], ["text", "Text", "area"]],
    lens: [["heading", "Heading"], ["band", "Printed text"], ["word", "Word to zoom on"], ["label", "Meaning"], ["text", "Extra line"]],
    compare: [["heading", "Heading"], ["left.title", "Left title"], ["left.text", "Left text"], ["left.icon", "Left icon", "icon"], ["left.mark", "Left mark", "mark"],
      ["right.title", "Right title"], ["right.text", "Right text"], ["right.icon", "Right icon", "icon"], ["right.mark", "Right mark", "mark"]],
    steps: [["heading", "Heading"], ["steps", "Steps", "steps"]],
    stop: [["heading", "Heading"], ["items", "Items (one per line)", "lines"]],
    endcard: [["image", "Product photo", "image"], ["title", "Tagline"], ["sub", "Product name"], ["cta", "Button"], ["icon", "Drawing if no photo", "icon"]]
  };
  const sDur = (x) => Math.max(0.6, Number(x.dur) || (GZS.TPL[x.tpl] || {}).dur || 3);
  const starts = () => { let a = 0; return doc.film.scenes.map((x) => { const b = a; a += sDur(x); return b; }); };
  const sceneAt = (t) => { let i = 0; starts().forEach((a, j) => { if (t >= a) i = j; }); return i; };
  const $a = (id) => document.getElementById(id);
  let actx = null;
  let dlg = null, itemId = null, doc = null, sel = null, k = 1, raf = 0, saveT = null, savedAt = 0, saving = false;
  let hist = [], fut = [], pending = null, tab = "layer", pxs = 40, linkSubs = true;
  const ROWS = [{ id: "sub", name: "字幕 Subtitles" }, { id: "text", name: "花字 Text" }, { id: "media", name: "素材 Stickers & images" }];
  const rowOf = (L) => (L.kind === "image" || L.kind === "sticker") ? "media" : L.group === "sub" ? "sub" : "text";
  const r2 = (n) => Math.round(n * 100) / 100;
  const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
  const cur = () => doc && doc.layers.find((L) => L.id === sel);
  const now = () => { if (FM) return ft; const v = $a("adjVid"); return v ? v.currentTime || 0 : 0; };

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
.adj-blk[data-scn] i.r{right:-2px;width:10px;cursor:col-resize;background:linear-gradient(90deg,transparent 3px,rgba(255,255,255,.9) 3px,rgba(255,255,255,.9) 6px,transparent 6px)}
.adj-blk[data-scn]{overflow:visible}
.adj-vo{cursor:ew-resize;font-size:10.5px;color:#0d4436;padding:0 4px}
.adj-fx{font-size:10.5px;padding:0 3px;text-align:center}
.adj-fx.off{opacity:.35}
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
      '<span class="adj-rs" id="adjRs"></span><button class="btn sm" type="button" data-a="board" id="adjBoard" hidden>▦ Storyboard</button><button class="btn primary sm" type="button" data-a="render" id="adjRender">Render new version</button></div>' +
      '<div class="adj-body"><div class="adj-left"><div class="adj-view" id="adjView"><div class="adj-box" id="adjBox"><div class="adj-stage" id="adjStage">' +
      '<video id="adjVid" playsinline preload="auto"></video><div class="adj-layers" id="adjLayers"></div><div class="adj-guide v" id="adjGv"></div><div class="adj-guide h" id="adjGh"></div></div>' +
      '<div class="adj-sel" id="adjSel" hidden><i id="adjHandle" title="Drag to resize"></i></div></div></div>' +
      '<div class="adj-ctl"><button class="btn sm" type="button" data-a="play" id="adjPlay" aria-label="Play">▶</button><span class="t" id="adjTime">0:00.0</span>' +
      '<input type="range" id="adjScrub" min="0" step="0.01" value="0" aria-label="Time"><button class="btn sm" type="button" data-a="addtext">+ Text</button></div></div>' +
      '<aside class="adj-side"><div class="adj-tabs" role="tablist"><button type="button" role="tab" data-tab="layer">Layer</button><button type="button" role="tab" data-tab="fb">Feedback <span id="adjFbN"></span></button></div><div class="adj-pan" id="adjPan"></div></aside></div>' +
      '<div class="adj-tl"><div class="adj-tlbar"><span id="adjTlHint">Timeline · drag a block to move it, its edges to trim</span><span style="flex:1"></span><button class="btn sm" type="button" data-a="zout" aria-label="Zoom out">−</button><button class="btn sm" type="button" data-a="zin" aria-label="Zoom in">+</button></div>' +
      '<div class="adj-tlsc"><div class="adj-tlnames" id="adjTlNames"></div><div class="adj-tlx" id="adjTlx"><div class="adj-tlin" id="adjTlin"></div></div></div></div></div>';
    document.body.appendChild(dlg);
    wire();
  }

  /* ---------- open / close / save ---------- */
  A.open = function (id, ctx, opts) {
    ({ db, items, edits, myId, readOnly, toast, esc, who, fbFor, attHtml, assets, typeFor } = ctx); actx = ctx; opts = opts || {};
    const d = edits.get(id);
    if (!d) { toast("This video has no adjustable project."); return; }
    ensureDom();
    itemId = id; doc = JSON.parse(JSON.stringify(d)); doc.layers = Array.isArray(doc.layers) ? doc.layers : [];
    doc.layers.forEach((L, i) => { if (!L.id) L.id = "L" + i + "-" + Math.random().toString(36).slice(2, 6); });
    sel = null; hist = []; fut = []; pending = null; tab = "layer";
    FM = !!(doc.film && window.GZS); sc = null; ft = 0; playing = false;
    if (FM) { doc.w = 1080; doc.h = 1920; doc.audio = doc.audio || {}; doc.dur = GZS.filmDur(doc.film); }
    const it = items.get(id);
    $a("adjTitle").textContent = (FM ? "Animation · " : "Adjust · ") + (it ? (it.code ? it.code + " " : "") + it.title : "video");
    const v = $a("adjVid");
    v.pause(); v.removeAttribute("src"); v.load();
    if (!FM) v.setAttribute("src", (doc.base && doc.base.url) || "");
    v.style.display = FM ? "none" : "";
    let fe = $a("adjFilm");
    if (!fe) { fe = document.createElement("div"); fe.id = "adjFilm"; fe.style.cssText = "position:absolute;inset:0;pointer-events:none"; $a("adjStage").insertBefore(fe, $a("adjLayers")); }
    fe.innerHTML = ""; fe._gzs = null; fe.style.display = FM ? "" : "none";
    fxSel = null; stopAudio();
    if (FM && db) db.collection("settings").doc("music").get().then((r) => { music = r.exists ? (r.data() || {}).files || [] : []; if (sel == null) panel(); preloadAudio(); }).catch(() => { music = []; });
    if (FM && db) db.collection("settings").doc("sfx").get().then((r) => { sfxFiles = r.exists ? (r.data() || {}).files || [] : []; if (sel == null) panel(); timeline(); preloadAudio(); }).catch(() => { sfxFiles = []; });
    $a("adjScrub").max = String(doc.dur || 1);
    const stage = $a("adjStage"); stage.style.width = doc.w + "px"; stage.style.height = doc.h + "px";
    const lay = $a("adjLayers"); lay.innerHTML = ""; lay._gzl = null;
    if (!dlg.open) dlg.showModal();
    fit(); pxs = Math.max(8, ($a("adjTlx").clientWidth - 20) / Math.max(1, doc.dur || 1));
    $a("adjBoard").hidden = !FM;
    $a("adjTlHint").textContent = FM ? "Timeline · drag a scene’s right edge to change where it ends · drag the voice to move it" : "Timeline · drag a block to move it, its edges to trim";
    $a("adjRender").textContent = FM ? "Export → Review" : "Render new version";
    $a("adjRender").title = FM ? "The Mac renders the MP4 and sends it to Review as the next version" : "";
    renderStatus(); panel(); timeline(); draw();
    if (FM && opts.scene != null && doc.film.scenes[opts.scene]) selectScene(opts.scene, true);
    if (FM && opts.play) play();
  };
  A.isOpen = () => !!(dlg && dlg.open);
  A.remote = function (id, d) {           // a new copy arrived from the database
    if (!A.isOpen() || id !== itemId || !d) return;
    doc.render = d.render; renderStatus();
    if (d.updatedBy !== myId && (d.updatedAt || 0) > savedAt && !saveT && !saving && !pending) {
      doc.layers = JSON.parse(JSON.stringify(d.layers || [])); doc.rev = d.rev; savedAt = d.updatedAt || 0;
      if (FM && d.film) { doc.film = JSON.parse(JSON.stringify(d.film)); doc.audio = JSON.parse(JSON.stringify(d.audio || {})); doc.dur = GZS.filmDur(doc.film); $a("adjScrub").max = String(doc.dur); if (sc != null && sc >= doc.film.scenes.length) sc = null; }
      if (sel && !cur()) sel = null; panel(); timeline(); draw();
    }
  };
  function close() { flush(); playing = false; stop(); stopAudio(); $a("adjVid").pause(); dlg.close(); if (actx && actx.onClose) setTimeout(actx.onClose, 0); }
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
      await db.collection("edits").doc(itemId).update(Object.assign({ layers: doc.layers, rev: (doc.rev || 0) + 1, updatedAt: t, updatedBy: myId || "" },
        FM ? { film: doc.film, audio: doc.audio || {}, dur: GZS.filmDur(doc.film) } : {}));
      doc.rev = (doc.rev || 0) + 1; savedAt = t; $a("adjSaved").textContent = "Saved";
    } catch (e) { $a("adjSaved").textContent = "Couldn’t save. Check your connection."; }
    saving = false;
  }

  /* ---------- history ---------- */
  const snap = () => JSON.stringify(FM ? { l: doc.layers, f: doc.film, a: doc.audio || {} } : doc.layers);
  function restore(str) { const o = JSON.parse(str); if (FM && !Array.isArray(o)) { doc.layers = o.l; doc.film = o.f; doc.audio = o.a; doc.dur = GZS.filmDur(doc.film); $a("adjScrub").max = String(doc.dur); if (sc != null && sc >= doc.film.scenes.length) sc = null; } else doc.layers = o; }
  function mark() { hist.push(snap()); if (hist.length > 120) hist.shift(); fut = []; }
  function begin() { if (!pending) pending = snap(); }
  function commit() { if (pending) { hist.push(pending); if (hist.length > 120) hist.shift(); fut = []; pending = null; } }
  function undo() { commit(); if (!hist.length) return; fut.push(snap()); restore(hist.pop()); after(); }
  function redo() { if (!fut.length) return; hist.push(snap()); restore(fut.pop()); after(); }
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
    if (FM) GZS.render($a("adjFilm"), doc.film, t, {});
    GZL.render($a("adjLayers"), doc, t, {});
    $a("adjTime").textContent = fmt(t) + " / " + fmt(doc.dur);
    if (document.activeElement !== $a("adjScrub")) $a("adjScrub").value = String(t);
    const ph = $a("adjPh"); if (ph) ph.style.left = t * pxs + "px";
    selBox();
  }
  const partEls = (i, key) => [...$a("adjFilm").querySelectorAll('[data-gzs="' + i + '"] [data-gzp="' + CSS.escape(key) + '"]')];
  function selBox() {
    const box = $a("adjSel"), L = cur();
    if (!L && FM && sc != null && part) {
      const els = partEls(sc, part).filter((e) => e.closest("[data-gzs]").style.display !== "none");
      if (!els.length) { box.hidden = true; return; }
      const rs = els.map((e) => e.getBoundingClientRect()), b = $a("adjBox").getBoundingClientRect();
      const l = Math.min(...rs.map((r) => r.left)), tp = Math.min(...rs.map((r) => r.top)), rt = Math.max(...rs.map((r) => r.right)), bt = Math.max(...rs.map((r) => r.bottom));
      box.hidden = false; $a("adjHandle").style.display = "none";
      box.style.left = l - b.left - 3 + "px"; box.style.top = tp - b.top - 3 + "px"; box.style.width = rt - l + 6 + "px"; box.style.height = bt - tp + 6 + "px";
      return;
    }
    $a("adjHandle").style.display = "";
    const el = L && $a("adjLayers").querySelector('.gzl[data-id="' + CSS.escape(L.id) + '"]');
    if (!el || el.style.display === "none") { box.hidden = true; return; }
    const r = el.getBoundingClientRect(), b = $a("adjBox").getBoundingClientRect();
    box.hidden = false;
    box.style.left = r.left - b.left - 3 + "px"; box.style.top = r.top - b.top - 3 + "px";
    box.style.width = r.width + 6 + "px"; box.style.height = r.height + 6 + "px";
  }
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  function play() {
    if (FM) {
      if (playing) { playing = false; stop(); stopAudio(); $a("adjPlay").textContent = "▶"; draw(); return; }
      if (ft >= doc.dur - 0.05) ft = 0;
      playing = true; playT0 = performance.now() - ft * 1000 + 60; $a("adjPlay").textContent = "❚❚"; startAudio(ft); floop(); return;
    }
    const v = $a("adjVid"); if (v.paused) { v.play().catch(() => {}); } else v.pause();
  }
  function floop() {
    if (!playing) return;
    ft = (performance.now() - playT0) / 1000;
    if (ft >= doc.dur) { ft = doc.dur; playing = false; stopAudio(); $a("adjPlay").textContent = "▶"; draw(); return; }
    draw(); raf = requestAnimationFrame(floop);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function seek(t) {
    if (FM) { ft = Math.max(0, Math.min(doc.dur || 0, t)); if (playing) { playT0 = performance.now() - ft * 1000 + 60; startAudio(ft); } draw(); if (!cur() && tab === "layer" && sc == null) panel(); return; }
    const v = $a("adjVid"); v.currentTime = Math.max(0, Math.min(doc.dur || 0, t)); draw();
  }
  function selectScene(i, jump, key) {
    commit(); sel = null; sc = i; tab = "layer"; fxSel = null;
    const S = doc.film.scenes[i], ps = (GZS.TPL[S && S.tpl] || {}).parts || [];
    part = key !== undefined ? key : ps.some((x) => x[0] === part) ? part : null;
    panel(); timeline();
    if (jump) { const a = starts()[i]; if (now() < a || now() >= a + sDur(doc.film.scenes[i])) seek(a + Math.min(1.4, sDur(doc.film.scenes[i]) * 0.6)); }
    draw();
  }

  /* ---------- selecting and changing layers ---------- */
  function select(id, jump) {
    commit(); sel = id; if (id) { sc = null; fxSel = null; } tab = "layer"; panel(); timeline();
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
    if (!L && FM && fxSel) { const fh = fxPanel(); if (fh) { pan.innerHTML = fh; return; } }
    if (!L && FM) { pan.innerHTML = scenePanel(sc == null ? sceneAt(now()) : sc); pan.querySelectorAll("textarea").forEach((x) => { x.style.height = "auto"; x.style.height = x.scrollHeight + 2 + "px"; }); return; }
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
  function scenePanel(i) {
    const n = doc.film.scenes.length, S = doc.film.scenes[i]; if (!S) return '<p class="hint">No scenes.</p>';
    const g = S.data || {}, au = doc.audio || {}, bg = (au.bgm || {});
    const icons = (k, v) => '<select data-sk="' + k + '">' + GZS.ICONS.map((x) => opt(x, v || "sparkle", x)).join("") + "</select>";
    let h = '<h4>Scene ' + (i + 1) + " of " + n + (sc == null ? " · on screen now" : "") + "</h4>" +
      field("Template", '<select data-sa="tpl">' + GZS.catalog().map((c) => opt(c.id, S.tpl, c.name)).join("") + "</select>") +
      field("Length", '<input type="number" data-sa="dur" min="0.6" max="30" step="0.1" value="' + r2(sDur(S)) + '"> s') +
      (i ? field("Comes in by", '<select data-sa="trans">' + opt("slide", S.trans || "slide", "Slide") + opt("zoom", S.trans, "Zoom") + opt("wipe", S.trans, "Wipe") + "</select>") : "");
    (SFIELDS[S.tpl] || []).forEach(([k, label, kind]) => {
      const v = getPath(g, k);
      if (kind === "icon") h += field(label, icons(k, v));
      else if (kind === "mark") h += field(label, '<select data-sk="' + k + '">' + opt("", v || "", "None") + opt("yes", v, "✓ Right") + opt("no", v, "✗ Wrong") + "</select>");
      else if (kind === "area") h += '<label class="hint">' + label + '</label><textarea data-sk="' + k + '" rows="2">' + esc(v || "") + "</textarea>";
      else if (kind === "lines") h += '<label class="hint">' + label + '</label><textarea data-sk="' + k + '" data-lines="1" rows="4">' + esc((v || []).join("\n")) + "</textarea>";
      else if (kind === "steps") h += '<label class="hint">' + label + "</label>" + (v || []).map((x, j) => '<div class="row">' + '<select data-sk="steps.' + j + '.icon"><option value="">No icon</option>' + GZS.ICONS.map((y) => opt(y, x.icon || "", y)).join("") + '</select><input type="text" data-sk="steps.' + j + '.text" value="' + esc(x.text || "") + '" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font:inherit"><button class="btn sm ghost" type="button" data-a="stepdel" data-i="' + j + '" aria-label="Remove step">×</button></div>').join("") + (readOnly ? "" : '<div class="row"><button class="btn sm ghost" type="button" data-a="stepadd">+ Step</button></div>');
      else if (kind === "image") {
        const st = g.imageCut === "pending" ? "The studio Mac is removing the background (within 3 minutes)…" : g.imageCut === "failed" ? "Couldn’t remove the background: " + (g.imageCutError || "") : "";
        h += '<label class="hint">' + label + '</label><div class="row">' + (g.image ? '<img src="' + esc(g.image.startsWith("/_blob/") || /^https?:/.test(g.image) || g.image.startsWith("brand/") ? g.image : "") + '" alt="" style="width:84px;height:84px;object-fit:contain;background:var(--sunk);border-radius:10px">' : '<span class="hint">No photo: a drawing is used.</span>') + "</div>" +
          (readOnly || !assets ? "" : '<div class="row"><label class="btn sm">' + (g.image ? "Replace photo" : "Upload photo") + '<input type="file" class="adj-up" accept="image/png,image/jpeg,image/webp" hidden></label>' + (g.image ? '<button class="btn sm ghost" type="button" data-a="nophoto">No photo</button>' : "") + '</div><label class="chk"><input type="checkbox" id="adjCut" checked> Remove the white background (done on the studio Mac)</label>') +
          (st ? '<p class="hint">' + esc(st) + "</p>" : "");
      } else h += field(label, '<input type="text" data-sk="' + k + '" value="' + esc(v || "") + '" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font:inherit">');
    });
    if (!readOnly) h += '<div class="row"><button class="btn sm" type="button" data-a="sadd">+ Scene after</button><button class="btn sm" type="button" data-a="sdup">Duplicate</button><button class="btn sm" type="button" data-a="sup" aria-label="Move earlier">↑</button><button class="btn sm" type="button" data-a="sdown" aria-label="Move later">↓</button><button class="btn sm ghost danger" type="button" data-a="sdel">Remove</button></div>';
    const parts = (GZS.TPL[S.tpl] || {}).parts || [];
    if (parts.length) {
      const pk = parts.some((x) => x[0] === part) ? part : null, st = (S.style || {})[pk] || {}, scaleOnly = pk && /^(icon|product|logo|card)$/.test(pk) || pk === "card";
      h += "<h4>Move & style</h4><p class=\"hint\">Drag the words on the video to move them, or pick one here.</p>" +
        field("Change", '<select data-ps="part"><option value="">Pick text…</option>' + parts.map(([k2, l2]) => opt(k2, pk || "", l2)).join("") + "</select>");
      if (pk) {
        const fonts = window.GZL ? GZL.FONTS : [];
        if (!scaleOnly) h += field("Font", '<select data-pst="font"><option value="">Template font</option>' + fonts.map((f) => opt(f.id, st.font || "", f.name)).join("") + "</select>") +
          field("Colour", '<input type="color" data-pst="color" value="' + esc(st.color || "#262A28") + '">' + (st.color ? '<button class="btn sm ghost" type="button" data-a="pcolor">Template colour</button>' : ""));
        if (pk !== "card") h += field("Size", '<input type="range" data-pst="size" min="40" max="250" step="5" value="' + Math.round((Number(st.size) || 1) * 100) + '"><input type="number" data-pst="size" min="40" max="250" step="5" value="' + Math.round((Number(st.size) || 1) * 100) + '"> %');
        h += field("Move", 'x <input type="number" data-pst="x" step="5" value="' + Math.round(st.x || 0) + '"> y <input type="number" data-pst="y" step="5" value="' + Math.round(st.y || 0) + '">') +
          '<div class="row"><button class="btn sm ghost" type="button" data-a="preset"' + (S.style && S.style[pk] ? "" : " disabled") + ">Back to template look</button></div>";
      }
    }
    h += "<h4>Whole video</h4>" + field("Look", '<select data-fa="theme">' + Object.keys(GZS.THEMES).map((t) => opt(t, doc.film.theme || "paper", GZS.THEMES[t].name)).join("") + "</select>") +
      soundPanel() +
      '<p class="hint">Tap a scene on the timeline to edit it. “+ Text” adds 花字 on top, like other videos.</p>';
    return h;
  }
  /* ---------- sound: voice-over, music, sound effects ---------- */
  function soundPanel() {
    const au = doc.audio || {}, vo = au.vo || {}, bg = au.bgm || {}, fx = au.sfx || {}, fa = (k, v, a, b, s) => rng(k, v, a, b, s).replace(/data-k=/g, "data-fa=");
    const vst = !vo.url ? "" : vo.align === "pending" ? "The studio Mac is fitting the scenes to the voice (within 3 minutes)…" : vo.align === "failed" ? "Couldn’t fit it: " + (vo.error || "unknown") :
      vo.align === "done" ? "Voice " + fmt(vo.dur || 0).replace(/\.\d$/, "") + " · scenes fitted to " + ((vo.lines || []).length) + " lines" : "";
    let h = "<h4>Voice-over</h4>" + (vo.url ? '<div class="row"><span class="hint" style="flex:1">🎙 ' + esc(vo.name || "Voice-over") + "</span></div>" + (vst ? '<p class="hint">' + esc(vst) + "</p>" : "") +
      field("Voice volume", fa("voVol", r2(vo.vol == null ? 1 : vo.vol), 0, 2, 0.05)) : '<p class="hint">Record the approved script, then upload it. The studio Mac cleans up the sound and fits every scene to its lines.</p>') +
      (readOnly ? "" : '<div class="row"><label class="btn sm' + (vo.url ? "" : " primary") + '">' + (vo.url ? "Replace" : "Upload voice-over") + '<input type="file" class="adj-vo" accept="audio/*,.m4a,.mp3,.wav,.aac,video/mp4,video/quicktime,.mov" hidden></label>' +
        (vo.url ? '<button class="btn sm" type="button" data-a="vofit"' + (vo.align === "pending" ? " disabled" : "") + '>Fit scenes again</button><button class="btn sm ghost danger" type="button" data-a="vodel">Remove</button>' : "") + "</div>");
    h += "<h4>Music</h4>" + field("Song", '<select data-fa="bgm"><option value="">None</option>' + (music || []).map((m) => opt(m.path, bg.path || "", m.name + (m.dur ? " (" + Math.round(m.dur) + "s)" : ""))).join("") + "</select>") +
      (bg.path ? field("Volume", fa("bgmVol", r2(bg.vol == null ? 0.35 : bg.vol), 0, 1, 0.05)) + '<label class="chk"><input type="checkbox" data-fa="duck"' + (bg.duck === false ? "" : " checked") + "> Quieter while someone talks</label>" : "") +
      (music && music.length ? "" : '<p class="hint">' + (music ? "No songs yet. " : "Loading songs… ") + "Put songs in the NAS folder <b>Content Video/Music</b>; the studio Mac lists them every 3 minutes.</p>");
    const plan = soundList(), on = fx.on !== false;
    h += "<h4>Sound effects</h4>" + '<label class="chk"><input type="checkbox" data-fa="sfxOn"' + (on ? " checked" : "") + "> Add sound effects (whoosh on transitions, pop, click, ding…)</label>" +
      (on ? field("Volume", fa("sfxVol", r2(fx.vol == null ? 0.6 : fx.vol), 0, 1.5, 0.05)) : "") +
      (sfxFiles && sfxFiles.length ? '<p class="hint">' + plan.filter((c) => c.file).length + " sounds placed. Tap one on the timeline to change or mute it.</p>" + (readOnly ? "" : '<div class="row"><button class="btn sm" type="button" data-a="fxadd">+ Sound at the playhead</button></div>')
        : '<p class="hint">' + (sfxFiles ? "No sound effects yet. " : "Loading… ") + "Put them in the NAS folder <b>Content Video/SFX</b>, with the kind in the file name: whoosh, pop, click, ding, wrong, alert.</p>");
    return h + '<p class="hint">Press ▶ to hear the voice, music and sound effects together.</p>';
  }
  const soundList = () => (FM && window.GZS && GZS.soundPlan ? GZS.soundPlan(doc.film, doc.audio || {}, sfxFiles || []) : []);
  function fxPanel() {
    const c = soundList().find((x) => x.id === fxSel); if (!c) { fxSel = null; return null; }
    const fx = (doc.audio || {}).sfx || {}, set = fx.set || {}, autoPick = c.auto ? GZS.sfxFor(c.kind, sfxFiles || []) : null;
    let h = "<h4>Sound at " + fmt(c.t) + "</h4>" + (c.auto ? '<p class="hint">Automatic: ' + esc(c.kind) + " · comes with the animation, so it moves when the scene does.</p>" : "") +
      field("Sound", '<select data-fx="file">' + (c.auto ? opt("@auto", c.id in set ? "" : "@auto", "Automatic" + (autoPick ? " (" + autoPick.name + ")" : "")) : "") + opt("", c.file ? "x" : "", "None (muted)") +
        (sfxFiles || []).map((f) => opt(f.name, c.auto && !(c.id in set) ? "" : (c.file || {}).name || "", f.name)).join("") + "</select>");
    if (!c.auto) h += field("Time", '<input type="number" data-fx="t" step="0.05" min="0" value="' + r2(c.t) + '"><button class="btn sm ghost" type="button" data-a="fxnow">Now</button>') +
      '<div class="row"><button class="btn sm ghost danger" type="button" data-a="fxdel">Remove</button></div>';
    return h + '<div class="row"><button class="btn sm" type="button" data-a="fxplay">▶ Hear it</button><button class="btn sm ghost" type="button" data-a="fxdone">Done</button></div>';
  }
  function fxInput(i) {
    const fx = doc.audio.sfx = Object.assign({}, (doc.audio = doc.audio || {}).sfx || {}), c = soundList().find((x) => x.id === fxSel); if (!c) return;
    begin();
    if (i.dataset.fx === "file") {
      if (c.auto) { fx.set = Object.assign({}, fx.set || {}); if (i.value === "@auto") delete fx.set[c.id]; else fx.set[c.id] = i.value; }
      else { fx.add = (fx.add || []).map((a) => (a.id === c.id ? Object.assign({}, a, { name: i.value }) : a)); }
    } else if (i.dataset.fx === "t" && !c.auto) { const n = Number(i.value); if (!(n >= 0)) return; fx.add = (fx.add || []).map((a) => (a.id === c.id ? Object.assign({}, a, { t: r2(n) }) : a)); }
    timeline(); changed(); preloadAudio();
  }
  async function uploadVO(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const type = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime" }[ext] || (/^(audio|video)\//.test(file.type) ? file.type : "");
    if (!type) { toast("Use an audio file (MP3, M4A, WAV) or a phone video."); return; }
    if (file.size > 50 * 1024 * 1024) { toast("Keep the voice-over under 50 MB."); return; }
    try {
      toast("Uploading the voice-over…");
      const r = await assets.upload(file, { type });
      mark(); doc.audio = doc.audio || {};
      doc.audio.vo = { url: r.url, name: file.name.slice(0, 80), vol: (doc.audio.vo && doc.audio.vo.vol) || 1, at: 0, align: "pending" };
      if (doc.audio.bgm && doc.audio.bgm.vol == null) doc.audio.bgm.vol = 0.35;
      panel(); timeline(); changed(); await flush();
      toast("Uploaded. The studio Mac fits the scenes to it within 3 minutes.");
    } catch (e) { toast(e && e.code === "too_large" ? "That file is too big." : "Upload failed. Try again."); }
  }

  function soundAction(a) {
    const au = doc.audio = doc.audio || {};
    if (a === "vofit" && au.vo) { mark(); au.vo = Object.assign({}, au.vo, { align: "pending" }); panel(); changed(); flush(); toast("Asked the studio Mac to fit the scenes again."); }
    else if (a === "vodel" && au.vo) { mark(); delete au.vo; panel(); timeline(); changed(); }
    else if (a === "fxadd") {
      const f = (sfxFiles || [])[0]; if (!f) return; mark();
      const id = "m" + Date.now().toString(36); au.sfx = Object.assign({}, au.sfx || {}); au.sfx.add = (au.sfx.add || []).concat([{ id, t: r2(now()), name: f.name }]);
      fxSel = id; sc = null; panel(); timeline(); changed(); preloadAudio();
    } else if (a === "fxdel") { mark(); au.sfx = Object.assign({}, au.sfx || {}); au.sfx.add = (au.sfx.add || []).filter((x) => x.id !== fxSel); fxSel = null; panel(); timeline(); changed(); }
    else if (a === "fxnow") { const i = $a("adjPan").querySelector('[data-fx="t"]'); if (i) { i.value = String(r2(now())); fxInput(i); commit(); panel(); } }
    else if (a === "fxplay") { const c = soundList().find((x) => x.id === fxSel); if (c && c.file && c.file.url) loadBuf(c.file.url).then((b) => { const ctx = audioCtx(); if (!b || !ctx) return; ctx.resume().catch(() => {}); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); }); }
    else if (a === "fxdone") { fxSel = null; panel(); timeline(); }
  }
  /* live sound while playing (Web Audio), so timing can be checked here */
  const AU = { ctx: null, buf: new Map(), nodes: [] };
  function audioCtx() { if (!AU.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) AU.ctx = new C(); } return AU.ctx; }
  function loadBuf(url) {
    if (!url) return Promise.resolve(null);
    if (!AU.buf.has(url)) AU.buf.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => new Promise((res, rej) => audioCtx().decodeAudioData(b, res, rej))).catch(() => null));
    return AU.buf.get(url);
  }
  function urls() {
    const au = (doc && doc.audio) || {}, m = (music || []).find((x) => x.path === (au.bgm || {}).path);
    return { vo: (au.vo || {}).url || "", bgm: (m && m.url) || "", fx: [...new Set(soundList().map((c) => c.file && c.file.url).filter(Boolean))] };
  }
  function preloadAudio() { if (!FM || !audioCtx()) return; const u = urls(); [u.vo, u.bgm].concat(u.fx).forEach(loadBuf); }
  function stopAudio() { AU.nodes.forEach((n) => { try { n.stop(); } catch (e) {} }); AU.nodes = []; }
  async function startAudio(from) {
    stopAudio(); const ctx = audioCtx(); if (!ctx || !doc || !FM) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const au = doc.audio || {}, u = urls(), t0 = ctx.currentTime + 0.06, end = doc.dur, mine = AU.nodes;
    const play = (buf, when, off, vol, loop, short) => {
      if (!buf || AU.nodes !== mine) return null;
      const late = Math.max(0, ctx.currentTime + 0.02 - when);
      if (short && late > 0.08) return null;            // a sound effect whose moment has passed
      const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.loop = !!loop; g.gain.value = vol; s.connect(g); g.connect(ctx.destination);
      let o = Math.max(0, off) + late; if (loop) o = o % buf.duration;
      if (!loop && o >= buf.duration) return null;
      s.start(when + late, o); s.stop(t0 + (end - from) + 0.05); mine.push(s); return g;
    };
    const vo = au.vo || {}, at = Number(vo.at) || 0, bg = au.bgm || {}, fx = au.sfx || {};
    const [vb, bb] = await Promise.all([loadBuf(u.vo), loadBuf(u.bgm)]);
    if (vb) play(vb, t0 + Math.max(0, at - from), from - at, Number(vo.vol == null ? 1 : vo.vol));
    if (bb) {
      const vol = Number(bg.vol == null ? (vb ? 0.35 : 0.8) : bg.vol), g = play(bb, t0, from % bb.duration, vol, true);
      if (g && vb && bg.duck !== false) (vo.segs || []).forEach(([s, e]) => { const a = t0 + s + at - from, b = t0 + e + at - from; if (b <= t0) return; g.gain.setTargetAtTime(vol * 0.3, Math.max(t0, a - 0.05), 0.04); g.gain.setTargetAtTime(vol, Math.max(t0, b + 0.1), 0.18); });
    }
    if (fx.on !== false) {
      const fv = Number(fx.vol == null ? 0.6 : fx.vol);
      for (const c of soundList()) { if (!c.file || !c.file.url || c.t < from - 0.02) continue; const b = await loadBuf(c.file.url); play(b, t0 + c.t - from, 0, fv, false, true); }
    }
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
    if (FM) {
      const st = starts(), cur2 = sc == null ? sceneAt(now()) : sc;
      const vo = (doc.audio || {}).vo || {}, at = Number(vo.at) || 0;
      if (vo.url) {
        nh += "<div>配音 Voice</div>";
        const sl = ((actx && actx.getScript && actx.getScript(itemId)) || {}).lines || [], useL = vo.lines && vo.lines.length;
        th += '<div class="adj-tlrow" style="width:' + W + 'px">' + ((useL || (vo.segs && vo.segs.length)) ? (useL ? vo.lines : vo.segs).map(([s, e], k) => '<div class="adj-blk adj-vo" data-vo="' + k + '" style="--c:#1E8C6B;left:' + (s + at) * pxs + "px;width:" + Math.max(3, (e - s) * pxs - 1) + 'px" title="' + esc((useL ? (k + 1) + ". " + ((sl[k] || {}).line || "") + " · " : "") + fmt(s + at) + "–" + fmt(e + at) + " · drag to move the whole voice") + '">' + (useL ? esc((k + 1) + " " + ((sl[k] || {}).line || "")) : "") + "</div>").join("") : '<span class="hint" style="font-size:11.5px;padding-left:6px;line-height:30px">' + (vo.align === "pending" ? "Waiting for the studio Mac…" : "") + "</span>") + "</div>";
      }
      const plan = soundList();
      if (plan.length) {
        nh += "<div>音效 Sounds</div>";
        th += '<div class="adj-tlrow" style="width:' + W + 'px">' + plan.map((c) => '<div class="adj-blk adj-fx' + (c.id === fxSel ? " on" : "") + (c.file ? "" : " off") + '" data-fx-id="' + esc(c.id) + '" style="--c:' + (c.auto ? "#2F80ED" : "#F2994A") + ";left:" + c.t * pxs + 'px;width:' + Math.max(10, 0.3 * pxs) + 'px" title="' + esc(fmt(c.t) + " · " + (c.file ? c.file.name : "muted") + (c.auto ? " · automatic " + c.kind : "")) + '">' + esc(c.file ? (c.kind || c.file.name).slice(0, 8) : "×") + "</div>").join("") + "</div>";
      }
      nh += "<div>动画 Scenes</div>";
      th += '<div class="adj-tlrow" style="width:' + W + 'px">' + doc.film.scenes.map((x, i) => '<div class="adj-blk' + (i === cur2 && sel == null ? " on" : "") + '" data-scn="' + i + '" style="--c:#7C4DFF;left:' + st[i] * pxs + "px;width:" + Math.max(6, sDur(x) * pxs - 2) + 'px" title="' + esc((GZS.TPL[x.tpl] || {}).name || x.tpl) + '">' + (i + 1) + " · " + esc(((GZS.TPL[x.tpl] || {}).name || x.tpl).split(" ")[0]) + '<i class="r" title="Drag to change where this scene ends"></i></div>').join("") + "</div>";
    }
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
      if (FM && /^(vofit|vodel|fxadd|fxdel|fxnow|fxplay|fxdone)$/.test(a)) { soundAction(a); return; }
      if (FM && (a === "preset" || a === "pcolor")) {
        const idx = sc == null ? sceneAt(now()) : sc, S = doc.film.scenes[idx];
        if (part && S.style && S.style[part]) { mark(); if (a === "preset") delete S.style[part]; else delete S.style[part].color; sc = idx; panel(); draw(); changed(); }
        return;
      }
      if (FM && /^(sadd|sdup|sdel|sup|sdown|stepadd|stepdel|nophoto)$/.test(a)) { sceneAction(a === "stepdel" ? "stepdel:" + b.dataset.i : a); return; }
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
      else if (a === "board" && actx.openBoard) { const id = itemId; close(); actx.openBoard(id); }
    });

    const pan = $a("adjPan");
    pan.addEventListener("input", (e) => {
      const i = e.target; if (i.id === "adjLink" || i.id === "adjCut") return;
      if (FM && i.dataset.fx) { fxInput(i); return; }
      if (FM && (i.dataset.sk != null || i.dataset.sa || i.dataset.fa || i.dataset.ps || i.dataset.pst)) { sceneInput(i); return; }
      const key = i.dataset.k; if (!key) return;
      begin();
      let val = i.type === "checkbox" ? i.checked : i.value;
      if (i.type === "range" || i.type === "number" || i.dataset.num) { val = Number(val); if (!isFinite(val)) return; }
      setVal(key, val);
      pan.querySelectorAll('[data-k="' + key + '"]').forEach((o) => { if (o !== i && o.type !== "checkbox") o.value = String(val); });
      if (key === "text") timeline();
    });
    pan.addEventListener("change", (e) => {
      if (e.target.classList.contains("adj-up") && e.target.files && e.target.files[0]) { uploadPhoto(e.target.files[0]); return; }
      if (e.target.classList.contains("adj-vo") && e.target.files && e.target.files[0]) { uploadVO(e.target.files[0]); return; }
      if (e.target.id === "adjLink") { linkSubs = e.target.checked; return; } commit();
    });
    pan.addEventListener("focusout", commit);

    // dragging on the video
    const lay = $a("adjLayers");
    let drag = null;
    const toVideo = (e) => { const b = $a("adjBox").getBoundingClientRect(); return { x: (e.clientX - b.left) / k, y: (e.clientY - b.top) / k }; };
    lay.addEventListener("pointerdown", (e) => {
      const el = e.target.closest(".gzl");
      if (!el && FM) {
        lay.style.pointerEvents = "none"; const fe = $a("adjFilm"); fe.style.pointerEvents = "auto";
        const hit = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest && x.closest("[data-gzp]")).find((x) => x && fe.contains(x));
        lay.style.pointerEvents = ""; fe.style.pointerEvents = "none";
        if (!hit) { part = null; selectScene(sceneAt(now())); draw(); return; }
        e.preventDefault();
        const i2 = Number(hit.closest("[data-gzs]").dataset.gzs), key = hit.dataset.gzp, S = doc.film.scenes[i2], st = (S.style || {})[key] || {};
        selectScene(i2, false, key); draw();
        if (readOnly) return;
        const p = toVideo(e);
        drag = { mode: "part", i: i2, key, px: p.x, py: p.y, x0: Number(st.x) || 0, y0: Number(st.y) || 0, snap: snap(), moved: false, els: partEls(i2, key) };
        lay.setPointerCapture(e.pointerId); return;
      }
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
      if (drag.mode === "part") {
        const p = toVideo(e); drag.x = Math.round(drag.x0 + p.x - drag.px); drag.y = Math.round(drag.y0 + p.y - drag.py);
        if (Math.abs(drag.x - drag.x0) + Math.abs(drag.y - drag.y0) > 2) drag.moved = true;
        drag.els.forEach((x) => { x.style.translate = drag.x + "px " + drag.y + "px"; }); selBox(); return;
      }
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
      if (drag.mode === "part") {
        if (drag.moved) { const S = doc.film.scenes[drag.i]; S.style = S.style || {}; const st = S.style[drag.key] = S.style[drag.key] || {}; st.x = drag.x; st.y = drag.y; hist.push(drag.snap); fut = []; panel(); draw(); changed(); }
        drag = null; return;
      }
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
      const scn = e.target.closest("[data-scn]"), rr = $a("adjTlin").getBoundingClientRect(), tt = (e.clientX - rr.left) / pxs;
      if (scn && e.target.classList.contains("r") && !readOnly) {           // move the end of a scene (the next one gives or takes the time)
        e.preventDefault(); commit();
        const i = Number(scn.dataset.scn), S = doc.film.scenes, b = S[i + 1];
        td = { mode: "scene", i, t0: tt, a0: sDur(S[i]), b0: b ? sDur(b) : 0, times: b && b.data && Array.isArray(b.data.times) ? b.data.times.slice() : null, snap: snap(), moved: false };
        tlx.setPointerCapture(e.pointerId); return;
      }
      if (scn) { selectScene(Number(scn.dataset.scn), true); return; }
      const vob = e.target.closest("[data-vo]");
      if (vob && !readOnly) { e.preventDefault(); commit(); td = { mode: "vo", t0: tt, at0: Number(((doc.audio || {}).vo || {}).at) || 0, snap: snap(), moved: false }; tlx.setPointerCapture(e.pointerId); return; }
      const fxb = e.target.closest("[data-fx-id]");
      if (fxb) {
        commit(); sel = null; fxSel = fxb.dataset.fxId; const c = soundList().find((x) => x.id === fxSel); panel(); timeline();
        if (c && !c.auto && !readOnly) { e.preventDefault(); td = { mode: "fx", id: c.id, t0: tt, s0: c.t, snap: snap(), moved: false }; tlx.setPointerCapture(e.pointerId); }
        else if (c) seek(Math.max(0, c.t - 0.3));
        return;
      }
      const vsk = e.target.closest(".adj-blk[data-seek]"); if (vsk) { seek(Number(vsk.dataset.seek)); return; }
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
      if (td.mode === "scene") {
        const S = doc.film.scenes, a = S[td.i], b = S[td.i + 1];
        const na = b ? Math.max(0.6, Math.min(td.a0 + td.b0 - 0.6, td.a0 + d)) : Math.max(0.6, td.a0 + d), moved = na - td.a0;
        a.dur = r2(na); if (b) { b.dur = r2(td.a0 + td.b0 - na); if (td.times) b.data.times = td.times.map((x) => r2(Math.max(0.3, x - moved))); }
        doc.dur = GZS.filmDur(doc.film); $a("adjScrub").max = String(doc.dur); td.moved = true;
        timeline(); seek(starts()[td.i] + na - 0.05); return;
      }
      if (td.mode === "vo") {
        const vo = doc.audio.vo; vo.at = r2(Math.max(0, td.at0 + d)); td.moved = true; timeline(); return;
      }
      if (td.mode === "fx") {
        const fx = doc.audio.sfx; fx.add = (fx.add || []).map((x) => (x.id === td.id ? Object.assign({}, x, { t: r2(Math.max(0, Math.min(doc.dur, td.s0 + d))) }) : x)); td.moved = true; timeline(); seek(Math.max(0, td.s0 + d)); return;
      }
      if (td.mode === "m") { L.start = r2(Math.max(0, Math.min(doc.dur - len, td.s0 + d))); L.end = r2(L.start + len); }
      else if (td.mode === "l") L.start = r2(Math.max(0, Math.min(td.e0 - 0.1, td.s0 + d)));
      else L.end = r2(Math.max(td.s0 + 0.1, Math.min(doc.dur, td.e0 + d)));
      td.moved = true;
      td.blk.style.left = L.start * pxs + "px"; td.blk.style.width = Math.max(6, (L.end - L.start) * pxs) + "px";
      seek(td.mode === "r" ? L.end - 0.04 : L.start + Math.min(0.3, (L.end - L.start) / 2)); syncFields();
    });
    const tUp = () => {
      if (!td) return;
      if (td.moved) { hist.push(td.snap); fut = []; changed(); timeline(); if (/^(scene|vo|fx)$/.test(td.mode)) panel(); if (playing) startAudio(ft); }
      td = null;
    };
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

  function sceneInput(i) {
    begin();
    const idx = sc == null ? sceneAt(now()) : sc, S = doc.film.scenes[idx]; let v = i.value;
    if (i.dataset.ps) { pending = null; part = i.value || null; sc = idx; panel(); draw(); return; }
    if (i.dataset.pst) {
      if (!part) return;
      const k2 = i.dataset.pst; S.style = S.style || {}; const st = S.style[part] = S.style[part] || {};
      if (k2 === "size") { const n = Number(v); if (!(n > 0)) return; st.size = Math.max(0.4, Math.min(2.5, n / 100)); $a("adjPan").querySelectorAll('[data-pst="size"]').forEach((x) => { if (x !== i) x.value = String(Math.round(st.size * 100)); }); }
      else if (k2 === "x" || k2 === "y") { const n = Number(v); if (!isFinite(n)) return; st[k2] = Math.round(n); }
      else if (v) st[k2] = v; else delete st[k2];
      sc = idx; draw(); changed(); return;
    }
    if (i.dataset.sk != null) {
      if (i.dataset.lines) v = v.split("\n").map((x) => x.trim()).filter(Boolean);
      S.data = S.data || {}; setPath(S.data, i.dataset.sk, v);
    } else if (i.dataset.sa === "dur") {
      v = Number(v); if (!(v > 0)) return;
      S.dur = Math.max(0.6, Math.min(30, v)); doc.dur = GZS.filmDur(doc.film); $a("adjScrub").max = String(doc.dur); timeline();
    } else if (i.dataset.sa === "tpl") {
      const old = S.data || {}, keep = old.title || old.heading || "";
      S.tpl = v; S.dur = GZS.TPL[v].dur; S.data = JSON.parse(JSON.stringify(SDEF[v]));
      if (keep) { if ("title" in S.data) S.data.title = keep; if ("heading" in S.data) S.data.heading = keep; }
      if (old.image && "image" in S.data) S.data.image = old.image;
      doc.dur = GZS.filmDur(doc.film); $a("adjScrub").max = String(doc.dur); sc = idx; panel(); timeline();
    } else if (i.dataset.sa) S[i.dataset.sa] = v;
    else if (i.dataset.fa === "theme") doc.film.theme = v;
    else if (i.dataset.fa === "bgm") { doc.audio = doc.audio || {}; doc.audio.bgm = v ? { path: v, vol: (doc.audio.bgm && doc.audio.bgm.vol != null) ? doc.audio.bgm.vol : 0.35, duck: !(doc.audio.bgm && doc.audio.bgm.duck === false) } : null; sc = idx; panel(); preloadAudio(); }
    else if (i.dataset.fa === "bgmVol") { if (doc.audio && doc.audio.bgm) doc.audio.bgm.vol = Number(v); }
    else if (i.dataset.fa === "duck") { if (doc.audio && doc.audio.bgm) doc.audio.bgm.duck = i.checked; }
    else if (i.dataset.fa === "voVol") { if (doc.audio && doc.audio.vo) doc.audio.vo.vol = Number(v); }
    else if (i.dataset.fa === "sfxOn") { doc.audio = doc.audio || {}; doc.audio.sfx = Object.assign({}, doc.audio.sfx || {}, { on: i.checked }); sc = idx; panel(); timeline(); }
    else if (i.dataset.fa === "sfxVol") { doc.audio = doc.audio || {}; doc.audio.sfx = Object.assign({}, doc.audio.sfx || {}, { vol: Number(v) }); }
    draw(); changed();
  }
  function sceneAction(a) {
    const idx = sc == null ? sceneAt(now()) : sc, list = doc.film.scenes, S = list[idx];
    if (a === "stepadd") { mark(); (S.data.steps = S.data.steps || []).push({ icon: "", text: "New step" }); }
    else if (a.startsWith("stepdel:")) { mark(); S.data.steps.splice(Number(a.slice(8)), 1); }
    else if (a === "nophoto") { mark(); S.data.image = ""; delete S.data.imageCut; }
    else if (a === "sadd") { mark(); list.splice(idx + 1, 0, { id: "s" + Date.now().toString(36), tpl: "iconText", dur: GZS.TPL.iconText.dur, trans: "slide", data: JSON.parse(JSON.stringify(SDEF.iconText)) }); sc = idx + 1; }
    else if (a === "sdup") { mark(); const c = JSON.parse(JSON.stringify(S)); c.id = "s" + Date.now().toString(36); list.splice(idx + 1, 0, c); sc = idx + 1; }
    else if (a === "sdel") { if (list.length < 2) { toast("A video needs at least one scene."); return; } mark(); list.splice(idx, 1); sc = Math.min(idx, list.length - 1); }
    else if (a === "sup" && idx > 0) { mark(); [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; sc = idx - 1; }
    else if (a === "sdown" && idx < list.length - 1) { mark(); [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; sc = idx + 1; }
    else return;
    doc.dur = GZS.filmDur(doc.film); $a("adjScrub").max = String(doc.dur);
    panel(); timeline(); if (a !== "stepadd" && !a.startsWith("stepdel") && a !== "nophoto") seek(starts()[sc] + Math.min(1.4, sDur(list[sc]) * 0.6)); draw(); changed();
  }
  async function uploadPhoto(file) {
    const idx = sc == null ? sceneAt(now()) : sc, S = doc.film.scenes[idx];
    if (!typeFor(file) || !/^image\//.test(typeFor(file))) { toast("Use a PNG, JPG or WebP photo."); return; }
    if (file.size > 20 * 1024 * 1024) { toast("Keep the photo under 20 MB."); return; }
    try {
      toast("Uploading…");
      const r = await assets.upload(file, { type: typeFor(file) });
      mark(); S.data.image = r.url;
      if ($a("adjCut") && $a("adjCut").checked) S.data.imageCut = "pending"; else delete S.data.imageCut;
      sc = idx; panel(); draw(); changed(); await flush();
      toast(S.data.imageCut ? "Uploaded. The studio Mac removes the background within 3 minutes." : "Photo added.");
    } catch (e) { toast("Upload failed. Try again."); }
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
  /* ---------- storyboard: one still per scene to check before making the video ---------- */
  let bd = null, bId = null, bctx = null;
  const BSTYLE = `
.sbd{border:0;padding:0;margin:0;inset:0;width:100%;height:100%;max-width:100%;max-height:100%;box-sizing:border-box;background:var(--bg,#F6F4EF);color:var(--ink)}
.sbd::backdrop{background:rgba(0,0,0,.4)}
.sb-wrap{display:grid;grid-template-rows:auto minmax(0,1fr);height:100%}
.sb-top{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface);flex-wrap:wrap}
.sb-top .ttl{flex:1;min-width:160px;display:flex;flex-direction:column}
.sb-top .ttl b{font-size:15px} .sb-top .ttl span{font-size:12.5px;color:var(--ink-2)}
.sb-pill{font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px;background:color-mix(in srgb,var(--review) 20%,var(--surface))}
.sb-pill.ok{background:color-mix(in srgb,var(--ready) 22%,var(--surface))}
.sb-body{overflow:auto;padding:16px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
.sb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
.sb-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px}
.sb-th{position:relative;width:100%;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#eee;cursor:pointer}
.sb-th>div{position:absolute;left:0;top:0;width:1080px;height:1920px;transform-origin:0 0}
.sb-n{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-3)}
.sb-n b{font-family:var(--display);font-size:15px;color:var(--ink)}
.sb-tr{font-size:11.5px;color:var(--ink-3)}
.sb-line{font-size:12.5px;color:var(--ink-2);border-left:3px solid var(--pink);padding-left:7px}
.sb-side{position:sticky;top:0;display:flex;flex-direction:column;gap:12px}
.sb-box{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}
.sb-box h3{margin:0;font-size:14px}
.sb-box textarea{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:8px;font:inherit;resize:vertical}
.sb-box .hint{font-size:12.5px;color:var(--ink-2);margin:0}
.sb-state{font-size:12.5px;border-radius:10px;padding:6px 10px;background:color-mix(in srgb,var(--review) 16%,var(--surface))}
.sb-state.err{background:color-mix(in srgb,var(--edit) 18%,var(--surface))}
@media (max-width:820px){.sb-body{grid-template-columns:1fr}.sb-side{position:static}.sb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
  function tStart(s) { const m = String(s || "").match(/(\d+(?:\.\d+)?)\s*[–\-~to]+\s*(\d+(?:\.\d+)?)/); return m ? [Number(m[1]), Number(m[2])] : null; }
  A.board = function (id, ctx) {
    bctx = ctx; bId = id;
    if (!bd) {
      const st = document.createElement("style"); st.textContent = BSTYLE; document.head.appendChild(st);
      bd = document.createElement("dialog"); bd.className = "sbd"; bd.setAttribute("aria-label", "Storyboard");
      bd.innerHTML = '<div class="sb-wrap"><div class="sb-top" id="sbTop"></div><div class="sb-body"><div class="sb-grid" id="sbGrid"></div><aside class="sb-side" id="sbSide"></aside></div></div>';
      document.body.appendChild(bd);
      bd.addEventListener("click", boardClick);
      bd.addEventListener("close", () => { bId = null; if (bctx && bctx.onClose) setTimeout(bctx.onClose, 0); });
    }
    if (!bd.open) bd.showModal();
    A.boardRefresh(true);
  };
  A.boardOpen = () => !!(bd && bd.open);
  let bSig = "";
  A.boardRefresh = function (force) {
    if (!bd || !bd.open || !bId) return;
    const c = bctx, e = c.getEdit(bId), s = c.getScript(bId) || {}, it = c.getItem(bId) || {}, E = c.esc;
    const film = e && e.film, ok = !!(e && e.board && e.board.state === "approved");
    const fg = s.filmGen || {}, busy = fg.state === "queued" || fg.state === "writing";
    $a("sbTop").innerHTML = '<button class="btn ghost sm" type="button" data-b="close" aria-label="Close">✕</button>' +
      '<div class="ttl"><b>Storyboard · ' + E((it.code ? it.code + " " : "") + (it.title || "")) + '</b><span>' + (film ? film.scenes.length + " scenes · " + Math.round(GZS.filmDur(film)) + " s" : "No storyboard yet") + "</span></div>" +
      (film ? '<span class="sb-pill' + (ok ? " ok" : "") + '">' + (ok ? "✓ Approved" + (e.board.by ? " · " + E(c.who(e.board.by)) : "") : "Waiting for your OK") + "</span>" : "") +
      (film ? (ok ? '<button class="btn primary sm" type="button" data-b="make">Open the video →</button>' : '<button class="btn primary sm" type="button" data-b="approve"' + (c.readOnly || busy ? " disabled" : "") + '>Looks good → Make the video</button>') : "");
    const fst = fg.state === "queued" ? "Waiting for the studio Mac (it checks every 3 minutes)…" : fg.state === "writing" ? "Claude is drawing the storyboard…" : fg.state === "failed" ? "Couldn’t make it: " + (fg.error || "unknown") : "";
    $a("sbSide").innerHTML = (fst ? '<div class="sb-state' + (fg.state === "failed" ? " err" : "") + '">' + E(fst) + "</div>" : "") +
      '<div class="sb-box"><h3>Ask Claude to change it</h3><textarea id="sbSteer" rows="3" placeholder="e.g. shorter, start with the nail close-up, pink look, add a compare scene"></textarea>' +
      '<button class="btn sm" type="button" data-b="redo"' + (busy || c.readOnly || !(s.lines || s.shots) ? " disabled" : "") + ">" + (film ? "Redo with Claude" : "Make storyboard with Claude") + "</button>" +
      '<p class="hint">' + (film ? "Redoing replaces the scenes and asks for your OK again. Your product photo and music stay." : "Claude turns the script into scenes from the Gearizo templates.") + "</p></div>" +
      (film ? '<div class="sb-box"><h3>Small changes</h3><p class="hint">Tap a scene to change its words, template, length or icon yourself.</p><button class="btn sm" type="button" data-b="edit">Edit scenes</button></div>' : "");
    const sig = JSON.stringify([film, s.lines]);
    if (!force && sig === bSig) return; bSig = sig;
    const grid = $a("sbGrid"); grid.innerHTML = "";
    if (!film) { grid.innerHTML = '<p class="hint">' + (busy ? "Claude is working on it…" : "No storyboard yet. Press “Make storyboard with Claude”.") + "</p>"; return; }
    // match the script lines to scenes by time (scaled to the film's length)
    const lines = (s.lines || []).map((l) => ({ l, r: tStart(l.t) })).filter((x) => x.r);
    const sEnd = Math.max(1, ...lines.map((x) => x.r[1])), fdur = GZS.filmDur(film), k2 = fdur / sEnd;
    let a0 = 0; const st0 = film.scenes.map((x) => { const b = a0; a0 += Math.max(0.6, Number(x.dur) || (GZS.TPL[x.tpl] || {}).dur || 3); return b; });
    film.scenes.forEach((x, i) => {
      const T = GZS.TPL[x.tpl] || {}, dur = Math.max(0.6, Number(x.dur) || T.dur || 3), a = st0[i], b = a + dur;
      const mine = lines.filter((y) => { const m = (y.r[0] + y.r[1]) / 2 * k2; return m >= a && (m < b || i === film.scenes.length - 1); });
      const card = document.createElement("div"); card.className = "sb-card";
      card.innerHTML = '<div class="sb-th" data-b="scene" data-i="' + i + '" title="Edit this scene"><div></div></div>' +
        '<div class="sb-n"><b>' + (i + 1) + '</b><span>' + E(T.name || x.tpl) + " · " + dur.toFixed(1) + " s</span></div>" +
        (i ? '<div class="sb-tr">' + ({ slide: "→ slides in", zoom: "→ zooms in", wipe: "→ wipes in" }[x.trans || "slide"] || "") + "</div>" : "") +
        mine.map((y) => '<div class="sb-line">' + E(y.l.line || "") + "</div>").join("");
      grid.appendChild(card);
      const th = card.querySelector(".sb-th"), stage = th.firstChild;
      requestAnimationFrame(() => {
        stage.style.transform = "scale(" + (th.clientWidth / 1080) + ")";
        try { GZS.render(stage, { theme: film.theme, scenes: [x] }, Math.min(dur - 0.05, dur * 0.8 + 0.6), {}); } catch (err) {}
      });
    });
  };
  async function boardClick(ev) {
    const b = ev.target.closest("[data-b]"); if (!b) return;
    const a = b.dataset.b, c = bctx, id = bId;
    if (a === "close") bd.close();
    else if (a === "edit" || a === "scene" || a === "make") { bd.close(); c.openAdjust(id, a === "scene" ? { scene: Number(b.dataset.i) } : a === "make" ? { play: true } : {}); }
    else if (a === "approve") {
      try { await c.db.collection("edits").doc(id).update({ board: { state: "approved", by: c.myId || "", at: Date.now() } }); }
      catch (err) { c.toast("Couldn’t save. Check your connection."); return; }
      c.toast("Storyboard approved. Here’s the video: fix anything, then Export → Review.");
      bd.close(); c.openAdjust(id, { play: true });
    } else if (a === "redo") {
      const g = { state: "queued", req: Date.now(), by: c.myId || "", steer: ($a("sbSteer").value || "").trim().slice(0, 1000) };
      try { await c.db.collection("scripts").doc(id).update({ filmGen: g }); c.toast("Sent to Claude on the studio Mac. The new storyboard shows here in a few minutes."); A.boardRefresh(true); }
      catch (err) { c.toast("Couldn’t send it. Check your connection."); }
    }
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

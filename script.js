/* Gearizo Script & storyboard: Claude (on the studio Mac) writes a video's script, shot list and AI-video prompts from
   the idea; the team edits it here, uploads each shot's clip, and approves it. Loaded on demand by app.js, which
   passes in what it needs. Data: docs/scripts/<item id>; a series' style and characters: docs/settings/series:<id>. */
(function () {
  "use strict";
  const S = window.gzScript = {};
  let db, assets, items, scripts, edits, openAdjust, myId, readOnly, toast, esc, who, typeFor, patchItem, seriesName, isHub;
  const $s = (id) => document.getElementById(id);
  let dlg = null, itemId = null, doc = null, series = null, seriesId = "", saveT = null, serT = null, lastLocal = 0;
  const KINDS = { AI: "AI video", REAL: "Film it", PRODUCT: "Product shot", DIAGRAM: "Diagram", CARD: "Card" };
  const KCOL = { AI: "#7C4DFF", REAL: "#1E8C6B", PRODUCT: "#E8772E", DIAGRAM: "#125F4E", CARD: "#8A9C95" };
  const LANGS = [["en", "English"], ["manglish", "Manglish"], ["bm", "BM"], ["zh", "中文"]];
  const busy = () => doc && doc.gen && (doc.gen.state === "queued" || doc.gen.state === "writing");
  const ta = (k, v, ph, rows, extra) => '<textarea data-f="' + k + '" rows="' + (rows || 2) + '" placeholder="' + esc(ph || "") + '"' + (extra || "") + ">" + esc(v || "") + "</textarea>";

  const STYLE = `
dialog.scr{width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--bg);color:var(--ink);overflow:hidden}
.scr-wrap{display:grid;grid-template-rows:auto minmax(0,1fr);height:100%}
.scr-top{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface);flex-wrap:wrap}
.scr-title{display:flex;flex-direction:column;min-width:0;flex:1 1 200px}
.scr-title b{font-family:var(--display);font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scr-title span{font-size:12px;color:var(--ink-3)}
.scr-body{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0}
.scr-main{overflow:auto;padding:18px clamp(14px,3vw,36px) 60px}
.scr-side{border-left:1px solid var(--line);background:var(--surface);overflow:auto;padding:14px 16px 40px;display:flex;flex-direction:column;gap:14px}
.scr-doc{max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.scr-doc textarea,.scr-side textarea,.scr-doc input,.scr-side input[type=text],.scr-side select{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit;font-size:14px;background:var(--surface);color:var(--ink);resize:vertical}
.scr-doc textarea:focus,.scr-doc input:focus{border-color:var(--ink-3);outline:none}
.scr-doc textarea[disabled],.scr-doc input[disabled]{background:var(--sunk);color:var(--ink-2)}
.scr-h{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin:10px 0 0;display:flex;align-items:center;gap:8px}
.scr-h .sp{flex:1}
.scr-grid{display:grid;grid-template-columns:1fr 110px 140px;gap:8px}
.scr-ttl{font-family:var(--display);font-size:22px !important;font-weight:700}
.scr-lines{display:flex;flex-direction:column;gap:6px}
.scr-line{display:grid;grid-template-columns:78px 110px minmax(0,1fr) 28px;gap:6px;align-items:start}
.scr-line textarea{min-height:38px}
.scr-x{border:0;background:none;color:var(--ink-3);cursor:pointer;font-size:16px;padding:6px 4px}
.scr-x:hover{color:var(--danger)}
.scr-shot{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.scr-shot .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.scr-shot .n{font-family:var(--display);font-weight:700;font-size:15px}
.scr-shot .hd input{width:90px;padding:4px 8px}
.scr-shot .hd select{border:1px solid var(--line);border-radius:999px;padding:3px 8px;font:inherit;font-size:12.5px;font-weight:600;color:#fff;background:var(--k)}
.scr-shot .hd .sp{flex:1}
.scr-pr{position:relative}
.scr-pr label{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink-2);margin-bottom:3px}
.scr-pr textarea{background:color-mix(in srgb,var(--k,#7C4DFF) 5%,var(--surface));font-size:13.5px}
.scr-clip{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--sunk);border-radius:12px;padding:8px 10px;font-size:13px;color:var(--ink-2)}
.scr-clip video,.scr-clip img{width:96px;height:170px;object-fit:cover;border-radius:8px;background:#000}
.scr-clip label.btn{cursor:pointer}
.scr-clip input[type=file]{display:none}
.scr-empty{border:2px dashed var(--line);border-radius:18px;padding:30px 20px;text-align:center;color:var(--ink-2)}
.scr-card{background:var(--sunk);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}
.scr-card h3{margin:0;font-size:14px;display:flex;align-items:center;gap:6px}
.scr-card .hint{font-size:12.5px;color:var(--ink-3);margin:0}
.scr-card .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.scr-card .chk{display:flex;gap:4px;align-items:center;font-size:13px;background:var(--surface);border-radius:999px;padding:4px 10px}
.scr-state{font-size:13px;padding:8px 10px;border-radius:10px;background:var(--surface)}
.scr-state.err{color:var(--danger)} .scr-state.ok{color:var(--ready)}
.scr-state.run{color:#7C4DFF}
.scr-state.run::before{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;background:#7C4DFF;margin-right:7px;animation:scrp 1s infinite alternate}
@keyframes scrp{to{opacity:.25}}
.scr-ch{background:var(--surface);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px}
.scr-ch .row input{flex:1}
.scr-pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:2px 8px}
.scr-pill.draft{background:color-mix(in srgb,var(--review) 22%,var(--surface));color:#7A5300}
.scr-pill.approved{background:var(--green-soft);color:var(--green)}
@media (max-width:900px){.scr-body{grid-template-columns:1fr;overflow:auto}.scr-main{overflow:visible}.scr-side{border-left:0;border-top:1px solid var(--line);overflow:visible}.scr-line{grid-template-columns:64px 1fr 28px}.scr-line .who{grid-column:2}.scr-line textarea{grid-column:1/3}.scr-grid{grid-template-columns:1fr 1fr}}
`;

  function ensureDom() {
    if (dlg) return;
    const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
    dlg = document.createElement("dialog"); dlg.className = "scr"; dlg.setAttribute("aria-label", "Script and storyboard");
    dlg.innerHTML = '<div class="scr-wrap"><div class="scr-top"><button class="btn ghost sm" type="button" data-s="close" aria-label="Close">✕</button>' +
      '<div class="scr-title"><b id="scrTitle"></b><span id="scrSaved"></span></div>' +
      '<button class="btn sm" type="button" data-s="copyall">Copy all</button></div>' +
      '<div class="scr-body"><div class="scr-main"><div class="scr-doc" id="scrDoc"></div></div><aside class="scr-side" id="scrSide"></aside></div></div>';
    document.body.appendChild(dlg);
    wire();
  }

  /* ---------- open / data ---------- */
  S.open = async function (id, ctx) {
    ({ db, assets, items, scripts, edits, openAdjust, myId, readOnly, toast, esc, who, typeFor, patchItem, seriesName, isHub } = ctx);
    const it = items.get(id); if (!it) return;
    ensureDom();
    itemId = id; seriesId = it.series || "";
    doc = JSON.parse(JSON.stringify(scripts.get(id) || {}));
    series = null;
    $s("scrTitle").textContent = "Script · " + (it.code ? it.code + " " : "") + it.title;
    $s("scrSaved").textContent = "";
    if (!dlg.open) dlg.showModal();
    drawAll();
    try { const r = await db.collection("settings").doc("series:" + seriesId).get(); series = r.exists ? r.data() || {} : {}; } catch (e) { series = {}; }
    side();
  };
  S.isOpen = () => !!(dlg && dlg.open);
  S.refresh = (e) => { edits = e || edits; if (S.isOpen()) side(); };
  S.remote = function (id, d) {
    if (!S.isOpen() || id !== itemId || !d) return;
    const wasBusy = busy(), gen = d.gen || {};
    if (saveT || ((d.updatedAt || 0) <= lastLocal && d.updatedBy === myId)) { doc.gen = gen; doc.filmGen = d.filmGen; if (wasFilm(d)) toast("The animation is ready. Press Open animation."); side(); return; }
    doc = JSON.parse(JSON.stringify(d));
    if (wasBusy && gen.state === "done") toast("Claude finished the script.");
    if (doc.filmGen && doc.filmGen.state === "done" && d.filmGen && (wasFilm(d))) toast("The animation is ready. Press Open animation.");
    drawAll();
  };
  function drawAll() { main(); side(); }
  let lastFilmState = "";
  function wasFilm(d) { const st = (d.filmGen || {}).state || ""; const was = lastFilmState; lastFilmState = st; return (was === "queued" || was === "writing") && st === "done"; }

  function changed() {
    $s("scrSaved").textContent = "Saving…";
    clearTimeout(saveT); saveT = setTimeout(save, 800);
  }
  async function save() {
    clearTimeout(saveT); saveT = null;
    if (readOnly || !db) return;
    const t = Date.now(); lastLocal = t;
    const body = { item: itemId, title: doc.title || "", length: Number(doc.length) || 0, lang: doc.lang || "", style: doc.style || "", cover: doc.cover || "",
      summary: doc.summary || "", prep: doc.prep || [], lines: doc.lines || [], shots: doc.shots || [], status: doc.status || "draft",
      approvedBy: doc.approvedBy || "", approvedAt: doc.approvedAt || 0, updatedAt: t, updatedBy: myId || "" };
    try {
      if (scripts.has(itemId)) await db.collection("scripts").doc(itemId).update(body);
      else await db.collection("scripts").doc(itemId).set(Object.assign(body, { gen: doc.gen || {} }));
      $s("scrSaved").textContent = "Saved";
    } catch (e) { $s("scrSaved").textContent = "Couldn’t save. Check your connection."; }
  }
  async function saveSeries() {
    clearTimeout(serT); serT = null;
    if (readOnly || !db || !seriesId) return;
    try { await db.collection("settings").doc("series:" + seriesId).set(series); $s("scrSaved").textContent = "Series saved"; }
    catch (e) { toast("Couldn’t save the series settings."); }
  }

  /* ---------- the document ---------- */
  function main() {
    const box = $s("scrDoc"), dis = busy() || readOnly ? " disabled" : "";
    const has = (doc.lines && doc.lines.length) || (doc.shots && doc.shots.length);
    if (!has) {
      box.innerHTML = '<div class="scr-empty"><p style="font-size:30px;margin:0">📝</p><p><b>No script yet.</b></p><p>Tell Claude what you want on the right and press <b>Write with Claude</b>.<br>Or <button class="btn sm" type="button" data-s="blank"' + dis + ">start one by hand</button>.</p></div>";
      return;
    }
    let h = '<input class="scr-ttl" data-f="title" placeholder="Working title" value="' + esc(doc.title || "") + '"' + dis + ">" +
      '<div class="scr-grid"><input data-f="cover" placeholder="Cover / hook text" value="' + esc(doc.cover || "") + '"' + dis + ">" +
      '<input data-f="length" type="number" min="1" step="1" placeholder="Seconds" title="Length in seconds" value="' + esc(doc.length || "") + '"' + dis + ">" +
      '<input data-f="style" placeholder="Style" value="' + esc(doc.style || "") + '"' + dis + "></div>" +
      ta("summary", doc.summary, "The idea and the takeaways", 2, dis) +
      '<p class="scr-h">Before you start</p>' + ta("prep", (doc.prep || []).join("\n"), "One note per line", Math.max(2, (doc.prep || []).length), dis) +
      '<p class="scr-h">Script<span class="sp"></span>' + (dis ? "" : '<button class="btn sm ghost" type="button" data-s="addline">+ Line</button>') + "</p><div class=\"scr-lines\">" +
      (doc.lines || []).map((l, i) => '<div class="scr-line" data-i="' + i + '"><input data-l="t" value="' + esc(l.t || "") + '" placeholder="0–2s"' + dis + '><input class="who" data-l="who" value="' + esc(l.who || "") + '" placeholder="Who"' + dis + ">" +
        '<textarea data-l="line" rows="1" placeholder="Line"' + dis + ">" + esc(l.line || "") + "</textarea>" + (dis ? "<span></span>" : '<button class="scr-x" type="button" data-s="delline" aria-label="Remove line">×</button>') + "</div>").join("") + "</div>" +
      '<p class="scr-h">Storyboard · ' + (doc.shots || []).length + ' shots<span class="sp"></span>' + (dis ? "" : '<button class="btn sm ghost" type="button" data-s="addshot">+ Shot</button>') + "</p>";
    (doc.shots || []).forEach((x, i) => {
      const k = KINDS[x.kind] ? x.kind : "AI", ai = k === "AI" || k === "PRODUCT", c = x.clip;
      h += '<div class="scr-shot" data-i="' + i + '" style="--k:' + KCOL[k] + '"><div class="hd"><span class="n">' + esc(x.n || "S" + (i + 1)) + '</span><input data-x="t" value="' + esc(x.t || "") + '" placeholder="0–2s"' + dis + ">" +
        '<select data-x="kind" aria-label="Kind of shot"' + dis + ">" + Object.keys(KINDS).map((kk) => '<option value="' + kk + '"' + (kk === k ? " selected" : "") + ">" + KINDS[kk] + "</option>").join("") + "</select><span class=\"sp\"></span>" +
        (dis ? "" : '<button class="scr-x" type="button" data-s="up" title="Move up">↑</button><button class="scr-x" type="button" data-s="down" title="Move down">↓</button><button class="scr-x" type="button" data-s="delshot" title="Remove shot">×</button>') + "</div>" +
        ta("x.desc", x.desc, "What happens in this shot", 2, dis);
      if (ai) h += '<div class="scr-pr"><label>首帧 First-frame prompt <button class="btn sm ghost" type="button" data-copy-f="first">Copy</button></label>' + ta("x.first", x.first, "Chinese image prompt", 3, dis) + "</div>" +
        '<div class="scr-pr"><label>动态 Motion prompt <button class="btn sm ghost" type="button" data-copy-f="motion">Copy</button></label>' + ta("x.motion", x.motion, "Chinese motion prompt", 1, dis) + "</div>";
      h += '<input data-x="text" placeholder="On-screen text added in editing (optional)" value="' + esc(x.text || "") + '"' + dis + ">" +
        '<div class="scr-clip">' + (c ? (/^image\//.test(c.type) ? '<img src="/_blob/' + esc(c.id) + '" alt="">' : '<video src="/_blob/' + esc(c.id) + '" controls playsinline preload="metadata"></video>') + "<span>" + esc(c.name || "clip") + "</span>" : "<span>No clip yet</span>") +
        (readOnly || !assets ? "" : '<label class="btn sm">' + (c ? "Replace" : "Upload clip") + '<input type="file" data-clip="' + i + '" accept="video/mp4,video/webm,image/png,image/jpeg,image/webp"></label>' + (c ? '<button class="btn sm ghost" type="button" data-s="delclip">Remove</button>' : "")) + "</div></div>";
    });
    box.innerHTML = h;
    box.querySelectorAll("textarea").forEach(grow);
  }
  function grow(t) { t.style.height = "auto"; t.style.height = Math.min(600, t.scrollHeight + 2) + "px"; }

  /* ---------- the side panel ---------- */
  function side() {
    const box = $s("scrSide"); if (!box) return;
    const it = items.get(itemId) || {}, g = doc.gen || {}, has = (doc.lines && doc.lines.length) || (doc.shots && doc.shots.length);
    const langs = new Set(g.langs || it.langs || ["en"]);
    const stTxt = g.state === "queued" ? "Waiting for the studio Mac (it checks every 3 minutes)…" : g.state === "writing" ? "Claude is writing…" :
      g.state === "failed" ? "Couldn’t write it: " + (g.error || "unknown") : g.state === "done" && g.doneAt ? "Written by Claude · " + new Date(g.doneAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
    let h = '<div class="scr-card"><h3>✨ Ask Claude</h3>' +
      (stTxt ? '<div class="scr-state ' + (g.state === "failed" ? "err" : busy() ? "run" : "ok") + '">' + esc(stTxt) + "</div>" : "") +
      '<label class="hint" for="scrSteer">' + (has ? "What should change?" : "What do you want? (optional)") + "</label>" +
      '<textarea id="scrSteer" rows="3" placeholder="' + (has ? "e.g. make the hook funnier, shorter, end on the product" : "e.g. 3D cartoon, Jay and Uncle Lim, the takeaway is…") + '">' + esc(g.steer && has ? "" : g.steer || "") + "</textarea>" +
      '<div class="row"><select id="scrLen" aria-label="Length" style="width:auto">' + [["", "Any length"], ["15", "15 s"], ["20", "20 s"], ["30", "30 s"], ["45", "45 s"], ["60", "60 s"]].map(([v, l]) => '<option value="' + v + '"' + (String(g.length || "") === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
      LANGS.map(([v, l]) => '<label class="chk"><input type="checkbox" data-lang="' + v + '"' + (langs.has(v) ? " checked" : "") + ">" + l + "</label>").join("") + "</div>" +
      '<button class="btn primary" type="button" data-s="write"' + (busy() || readOnly ? " disabled" : "") + ">" + (has ? "Rewrite with Claude" : "Write with Claude") + "</button>" +
      '<p class="hint">Claude uses the title, the Notes on the Plan tab and the series settings below.' + (has ? " Rewriting keeps uploaded clips with their shots." : "") + "</p></div>";
    if (has && isHub) {
      const fg = doc.filmGen || {}, fbusy = fg.state === "queued" || fg.state === "writing", film = edits && edits.get(itemId), isFilm = film && film.film;
      lastFilmState = lastFilmState || fg.state || "";
      const fst = fg.state === "queued" ? "Waiting for the studio Mac (it checks every 3 minutes)…" : fg.state === "writing" ? "Claude is laying out the scenes…" : fg.state === "failed" ? "Couldn’t make it: " + (fg.error || "unknown") : "";
      h += '<div class="scr-card"><h3>🎬 Animation</h3><p class="hint">Claude turns this script into an animated video from the Gearizo templates. You adjust it after.</p>' +
        (fst ? '<div class="scr-state ' + (fg.state === "failed" ? "err" : "run") + '">' + esc(fst) + "</div>" : "") +
        (isFilm ? '<div class="row"><button class="btn go sm" type="button" data-s="openfilm">Open animation</button><span class="hint">' + film.film.scenes.length + " scenes</span></div>" : "") +
        (film && !isFilm ? '<p class="hint">This video already has a filmed project (Adjust).</p>' : '<textarea id="scrFilmSteer" rows="2" placeholder="Optional: e.g. pink look, more steps, shorter"></textarea><button class="btn sm' + (isFilm ? "" : " primary") + '" type="button" data-s="makefilm"' + (fbusy || busy() || readOnly ? " disabled" : "") + ">" + (isFilm ? "Make it again with Claude" : "Make animation with Claude") + "</button>" + (isFilm ? '<p class="hint">Making it again keeps your product photo, music and 花字; scene edits are replaced.</p>' : "")) + "</div>";
    }
    if (has) {
      h += '<div class="scr-card"><h3>Approval <span class="scr-pill ' + (doc.status === "approved" ? "approved" : "draft") + '">' + (doc.status === "approved" ? "Approved" : "Draft") + "</span></h3>" +
        (doc.status === "approved" ? '<p class="hint">' + esc(who(doc.approvedBy)) + (doc.approvedAt ? " · " + new Date(doc.approvedAt).toLocaleDateString() : "") + '</p><div class="row"><button class="btn sm" type="button" data-s="unapprove"' + (readOnly ? " disabled" : "") + ">Back to draft</button></div>"
          : '<p class="hint">Approve when the script is good to produce.</p><div class="row"><button class="btn go sm" type="button" data-s="approve"' + (readOnly || busy() ? " disabled" : "") + ">Approve script</button></div>") +
        '<div class="row"><button class="btn sm ghost" type="button" data-s="tonotes"' + (readOnly ? " disabled" : "") + '>Copy lines to Notes</button></div><p class="hint">Notes go with the video into shoots, so HR sees the lines.</p></div>';
    }
    const ser = series;
    if (isHub) h += '<div class="scr-card"><h3>🎬 Series · ' + esc(seriesName(seriesId)) + "</h3>";
    if (!isHub) { /* series settings are the content team's */ } else if (!ser) h += '<p class="hint">Loading…</p>';
    else {
      h += '<p class="hint">Every script in this series uses these, so the look stays the same.</p>' +
        '<label class="hint">Style words (end of every image prompt)</label><textarea data-ser="style" rows="3" placeholder="e.g. 3D卡通动画风格，C4D渲染，色彩明亮温暖，竖屏构图，高清"' + (readOnly ? " disabled" : "") + ">" + esc(ser.style || "") + "</textarea>" +
        '<label class="hint">Characters</label>' + (ser.characters || []).map((c, i) => '<div class="scr-ch" data-ci="' + i + '"><div class="row"><input type="text" data-ch="name" placeholder="Name" value="' + esc(c.name || "") + '"' + (readOnly ? " disabled" : "") + '><button class="scr-x" type="button" data-s="delch" aria-label="Remove character">×</button></div>' +
          '<textarea data-ch="desc" rows="3" placeholder="Look, age, clothes… (the 三视图 prompt)"' + (readOnly ? " disabled" : "") + ">" + esc(c.desc || "") + "</textarea></div>").join("") +
        (readOnly ? "" : '<div class="row"><button class="btn sm ghost" type="button" data-s="addch">+ Character</button></div>') +
        '<label class="hint">Series notes</label><textarea data-ser="notes" rows="2" placeholder="Tone, recurring jokes, end card…"' + (readOnly ? " disabled" : "") + ">" + esc(ser.notes || "") + "</textarea>";
    }
    if (isHub) h += "</div>";
    box.innerHTML = h;
    box.querySelectorAll("textarea").forEach(grow);
  }

  /* ---------- actions ---------- */
  async function requestWrite() {
    if (readOnly || !db) return;
    if (saveT) await save();
    const it = items.get(itemId) || {}, has = (doc.lines && doc.lines.length) || (doc.shots && doc.shots.length);
    const langs = [...$s("scrSide").querySelectorAll("[data-lang]:checked")].map((i) => i.dataset.lang);
    const gen = { state: "queued", req: Date.now(), by: myId || "", steer: $s("scrSteer").value.trim().slice(0, 1500), length: Number($s("scrLen").value) || 0, langs, rewrite: !!has };
    try {
      if (scripts.has(itemId)) await db.collection("scripts").doc(itemId).update({ gen });
      else await db.collection("scripts").doc(itemId).set({ item: itemId, status: "draft", lines: [], shots: [], gen, updatedAt: Date.now(), updatedBy: myId || "" });
      doc.gen = gen; main(); side();
      if (it.status === "idea") patchItem(itemId, { status: "script" });
      toast("Sent to Claude on the studio Mac. The script appears here in a few minutes.");
    } catch (e) { toast("Couldn’t send it. Check your connection."); }
  }
  function copy(text, what) {
    if (!text) { toast("Nothing to copy."); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast((what || "Copied") + " ✓"), () => toast("Couldn’t copy."));
  }
  function asText() {
    const it = items.get(itemId) || {};
    const L = [(it.code ? it.code + " " : "") + (doc.title || it.title || ""), [doc.length ? doc.length + " seconds" : "", doc.style, doc.lang].filter(Boolean).join(" · ")];
    if (doc.cover) L.push("Cover text: " + doc.cover);
    if (doc.summary) L.push(doc.summary);
    if ((doc.prep || []).length) L.push("", "Before you start", ...doc.prep.map((p, i) => i + 1 + ". " + p));
    if ((doc.lines || []).length) L.push("", "Script", ...doc.lines.map((l) => l.t + "  " + l.who + ": " + l.line));
    (doc.shots || []).forEach((x) => {
      L.push("", x.n + " · " + x.t + "  [" + (KINDS[x.kind] || x.kind) + "]", x.desc || "");
      if (x.first) L.push("首帧 First-frame prompt", x.first);
      if (x.motion) L.push("动态 Motion prompt", x.motion);
      if (x.text) L.push("On screen: " + x.text);
    });
    return L.join("\n");
  }

  function wire() {
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    dlg.addEventListener("click", async (e) => {
      const cf = e.target.closest("[data-copy-f]");
      if (cf) { const i = Number(cf.closest(".scr-shot").dataset.i), x = doc.shots[i]; copy(x[cf.dataset.copyF], (x.n || "") + (cf.dataset.copyF === "first" ? " first-frame prompt copied" : " motion prompt copied")); return; }
      const b = e.target.closest("[data-s]"); if (!b) return;
      const a = b.dataset.s, shot = b.closest(".scr-shot"), si = shot ? Number(shot.dataset.i) : -1;
      if (a === "close") close();
      else if (a === "write") requestWrite();
      else if (a === "openfilm") { await close(); openAdjust(itemId); }
      else if (a === "makefilm") {
        if (saveT) await save();
        const g = { state: "queued", req: Date.now(), by: myId || "", steer: ($s("scrFilmSteer") || {}).value ? $s("scrFilmSteer").value.trim().slice(0, 1000) : "" };
        try { await db.collection("scripts").doc(itemId).update({ filmGen: g }); doc.filmGen = g; lastFilmState = "queued"; side(); toast("Sent to Claude on the studio Mac. The animation appears here in a few minutes."); }
        catch (err) { toast("Couldn’t send it. Check your connection."); }
      }
      else if (a === "copyall") copy(asText(), "Script copied");
      else if (a === "blank") { doc.lines = [{ t: "0–3s", who: "", line: "" }]; doc.shots = [{ n: "S1", t: "0–3s", kind: "AI", desc: "", first: "", motion: "", text: "" }]; doc.status = "draft"; drawAll(); changed(); }
      else if (a === "addline") { (doc.lines = doc.lines || []).push({ t: "", who: "", line: "" }); main(); changed(); }
      else if (a === "delline") { doc.lines.splice(Number(b.closest(".scr-line").dataset.i), 1); main(); changed(); }
      else if (a === "addshot") { (doc.shots = doc.shots || []).push({ n: "S" + (doc.shots.length + 1), t: "", kind: "AI", desc: "", first: "", motion: "", text: "" }); main(); changed(); }
      else if (a === "delshot") { if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Remove?"; return; } doc.shots.splice(si, 1); renumber(); main(); changed(); }
      else if (a === "up" && si > 0) { [doc.shots[si - 1], doc.shots[si]] = [doc.shots[si], doc.shots[si - 1]]; renumber(); main(); changed(); }
      else if (a === "down" && si < doc.shots.length - 1) { [doc.shots[si + 1], doc.shots[si]] = [doc.shots[si], doc.shots[si + 1]]; renumber(); main(); changed(); }
      else if (a === "delclip") { delete doc.shots[si].clip; main(); changed(); }
      else if (a === "approve") { doc.status = "approved"; doc.approvedBy = myId || ""; doc.approvedAt = Date.now(); side(); changed(); toast("Script approved."); }
      else if (a === "unapprove") { doc.status = "draft"; doc.approvedBy = ""; doc.approvedAt = 0; side(); changed(); }
      else if (a === "tonotes") {
        const txt = (doc.lines || []).map((l) => (l.t ? l.t + "  " : "") + (l.who ? l.who + ": " : "") + l.line).join("\n");
        if (!txt.trim()) { toast("No lines yet."); return; }
        const it = items.get(itemId); if (!it) return;
        patchItem(itemId, { notes: (it.notes && !it.notes.includes(txt) ? it.notes.trim() + "\n\n" : "") + (it.notes && it.notes.includes(txt) ? it.notes : txt) });
        toast("Lines copied into the video’s Notes.");
      }
      else if (a === "addch") { (series.characters = series.characters || []).push({ name: "", desc: "" }); side(); }
      else if (a === "delch") { series.characters.splice(Number(b.closest(".scr-ch").dataset.ci), 1); side(); clearTimeout(serT); serT = setTimeout(saveSeries, 600); }
    });
    dlg.addEventListener("input", (e) => {
      const t = e.target;
      if (t.tagName === "TEXTAREA") grow(t);
      if (t.dataset.ser != null || t.dataset.ch != null) {
        if (!series) return;
        if (t.dataset.ser) series[t.dataset.ser] = t.value;
        else series.characters[Number(t.closest(".scr-ch").dataset.ci)][t.dataset.ch] = t.value;
        $s("scrSaved").textContent = "Saving…"; clearTimeout(serT); serT = setTimeout(saveSeries, 900); return;
      }
      if (t.dataset.f) {
        const f = t.dataset.f;
        if (f === "prep") doc.prep = t.value.split("\n").map((s) => s.trim()).filter(Boolean);
        else if (f === "length") doc.length = Number(t.value) || 0;
        else if (f.startsWith("x.")) doc.shots[Number(t.closest(".scr-shot").dataset.i)][f.slice(2)] = t.value;
        else doc[f] = t.value;
        changed(); return;
      }
      if (t.dataset.l) { doc.lines[Number(t.closest(".scr-line").dataset.i)][t.dataset.l] = t.value; changed(); return; }
      if (t.dataset.x) {
        const x = doc.shots[Number(t.closest(".scr-shot").dataset.i)]; x[t.dataset.x] = t.value;
        if (t.dataset.x === "kind") main();
        changed();
      }
    });
    dlg.addEventListener("change", async (e) => {
      const f = e.target.closest("[data-clip]"); if (!f || !f.files || !f.files[0]) return;
      const file = f.files[0], i = Number(f.dataset.clip);
      if (!typeFor(file)) { toast("Use an MP4 clip or a picture (PNG, JPG, WebP)."); return; }
      if (file.size > 20 * 1024 * 1024) { toast("Keep each clip under 20 MB (export a smaller preview)."); return; }
      const lab = f.closest("label"); lab.firstChild.textContent = "Uploading…";
      try {
        const r = await assets.upload(file, { type: typeFor(file) });
        doc.shots[i].clip = { id: r.id, name: file.name, type: r.contentType || typeFor(file), size: file.size, at: Date.now(), by: myId || "" };
        main(); changed(); toast("Clip uploaded to " + (doc.shots[i].n || "the shot") + ".");
      } catch (err) { toast("Upload failed. Try again."); main(); }
    });
  }
  function renumber() { (doc.shots || []).forEach((x, i) => { if (/^S\d+[a-z]?$/i.test(x.n || "") || !x.n) x.n = "S" + (i + 1); }); }
  async function close() { if (saveT) await save(); if (serT) await saveSeries(); dlg.close(); }
})();

/* Gearizo editable video layers: subtitles, 花字 (styled text), images and stickers drawn over a base video.
   The same code draws the live preview in the app's Adjust screen and the frames the Mac renders, so what you
   see while adjusting is what comes out. Positions are in video pixels; x/y is the centre of the layer.

   doc   = {w, h, fps, dur, base:{nas, url}, layers:[layer...], dir}
   layer = {id, kind:"text"|"image"|"sticker", group:"sub"|"", name, text, x, y, s, rot, start, end,
            anim:{in:"none"|"pop"|"fade"|"up", out:"none"|"fade"}, style:{...}, w, src:{nas, url}}
   Stickers are animated clips (e.g. .mov with transparency): the app shows a still, the Mac overlays the clip. */
(function (root) {
  "use strict";
  const FONTS = [
    { id: "heiti", name: "粗黑体", fam: "'Noto Sans SC'", g: "Noto+Sans+SC:wght@400;500;700;900" },
    { id: "huangyou", name: "黄油体", fam: "'ZCOOL QingKe HuangYou'", g: "ZCOOL+QingKe+HuangYou" },
    { id: "kuaile", name: "快乐体", fam: "'ZCOOL KuaiLe'", g: "ZCOOL+KuaiLe" },
    { id: "xiaowei", name: "小薇体", fam: "'ZCOOL XiaoWei'", g: "ZCOOL+XiaoWei" },
    { id: "maobi", name: "毛笔字", fam: "'Ma Shan Zheng'", g: "Ma+Shan+Zheng" },
    { id: "song", name: "宋体", fam: "'Noto Serif SC'", g: "Noto+Serif+SC:wght@400;700;900" },
    { id: "montserrat", name: "Montserrat", fam: "'Montserrat'", g: "Montserrat:ital,wght@0,400;0,700;0,900;1,900" },
    { id: "bebas", name: "Bebas Neue", fam: "'Bebas Neue'", g: "Bebas+Neue" },
    { id: "anton", name: "Anton", fam: "'Anton'", g: "Anton" }
  ];
  const FALLBACK = ",'PingFang SC','Hiragino Sans GB','Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  const DEF = { font: "heiti", size: 64, weight: 900, italic: false, color: "#FFFFFF", stroke: "#000000", strokeW: 0,
    shadow: "#000000", shadowA: 0, shadowBlur: 12, shadowY: 6, bg: "#000000", bgA: 0, radius: 16, pad: 16, maxW: 0, lh: 1.25, ls: 0 };
  const ANIM_T = 0.25;
  const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  const fontsHref = () => "https://fonts.googleapis.com/css2?" + FONTS.map((f) => "family=" + f.g).join("&") + "&display=block";
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const style = (L) => Object.assign({}, DEF, (L && L.style) || {});
  const rgba = (hex, a) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const n = m ? parseInt(m[1], 16) : 0;
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + Math.max(0, Math.min(1, a)) + ")";
  };

  /* how a layer looks at time t: null when hidden */
  function state(L, t) {
    const st = num(L.start, 0), en = num(L.end, st + 2);
    if (t < st || t >= en) return null;
    const a = t - st, b = en - t, an = L.anim || {};
    let op = 1, sc = 1, dy = 0;
    if (an.in === "pop" && a < ANIM_T) { const p = a / ANIM_T, c = 1.70158; sc = Math.max(0.01, 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)); op = Math.min(1, p * 3); }
    else if (an.in === "fade" && a < ANIM_T) op = a / ANIM_T;
    else if (an.in === "up" && a < ANIM_T) { const p = 1 - Math.pow(1 - a / ANIM_T, 3); dy = (1 - p) * 60; op = p; }
    if (an.out === "fade" && b < ANIM_T) op = Math.min(op, b / ANIM_T);
    return { op: op, sc: sc, dy: dy };
  }

  /* every time something starts, stops or moves: the Mac captures a frame at each, and holds it until the next */
  function captureTimes(doc, fps) {
    const dur = num(doc.dur, 0), step = 1 / (fps || num(doc.fps, 30)), set = new Set([0]);
    const add = (t) => { if (t >= 0 && t < dur) set.add(Math.round(t * 1000) / 1000); };
    (doc.layers || []).filter((L) => L.kind !== "sticker").forEach((L) => {
      const st = num(L.start, 0), en = num(L.end, st + 2), an = L.anim || {};
      add(st); add(en);
      if (an.in && an.in !== "none") for (let t = st; t < Math.min(en, st + ANIM_T); t += step) add(t);
      if (an.out === "fade") for (let t = Math.max(st, en - ANIM_T); t < en; t += step) add(t);
    });
    return [...set].sort((a, b) => a - b);
  }

  function sig(L) { const c = Object.assign({}, L); ["x", "y", "s", "rot", "start", "end", "anim"].forEach((k) => delete c[k]); return JSON.stringify(c); }

  function build(L, opts) {
    const s = style(L), wrap = document.createElement("div");
    wrap.className = "gzl gzl-" + (L.kind || "text");
    wrap.dataset.id = L.id;
    wrap.style.cssText = "position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform,opacity;";
    if (L.kind === "image" || L.kind === "sticker") {
      const img = document.createElement("img");
      img.alt = ""; img.draggable = false;
      img.style.cssText = "display:block;max-width:none;pointer-events:none;" + (num(L.w, 0) ? "width:" + L.w + "px;height:auto;" : "");
      const src = opts.local && L.src && L.src.file ? L.src.file : L.src && L.src.url;
      if (src) img.setAttribute("src", src);
      wrap.appendChild(img);
      if (s.shadowA > 0) wrap.style.filter = "drop-shadow(0 " + s.shadowY + "px " + s.shadowBlur + "px " + rgba(s.shadow, s.shadowA) + ")";
      return wrap;
    }
    const box = document.createElement("div");
    const font = fontOf(s.font).fam + FALLBACK;
    box.style.cssText = "position:relative;display:block;white-space:pre-wrap;word-break:break-word;text-align:center;" +
      "font-family:" + font + ";font-size:" + s.size + "px;font-weight:" + s.weight + ";line-height:" + s.lh + ";letter-spacing:" + s.ls + "px;" +
      (s.italic ? "font-style:italic;" : "") + (s.maxW > 0 ? "max-width:" + s.maxW + "px;width:max-content;" : "width:max-content;") +
      (s.bgA > 0 ? "background:" + rgba(s.bg, s.bgA) + ";border-radius:" + s.radius + "px;padding:" + s.pad + "px " + Math.round(s.pad * 1.4) + "px;" : "");
    const txt = String(L.text == null ? "" : L.text);
    if (s.strokeW > 0) {
      const back = document.createElement("span");
      const p = s.bgA > 0 ? s.pad + "px " + Math.round(s.pad * 1.4) + "px" : "0";
      back.setAttribute("aria-hidden", "true");
      back.textContent = txt;
      back.style.cssText = "position:absolute;inset:0;padding:" + p + ";color:" + s.stroke + ";-webkit-text-stroke:" + (s.strokeW * 2) + "px " + s.stroke + ";pointer-events:none;";
      box.appendChild(back);
    }
    const front = document.createElement("span");
    front.textContent = txt;
    front.style.cssText = "position:relative;color:" + s.color + ";";
    box.appendChild(front);
    if (s.shadowA > 0) box.style.filter = "drop-shadow(0 " + s.shadowY + "px " + s.shadowBlur + "px " + rgba(s.shadow, s.shadowA) + ")";
    wrap.appendChild(box);
    return wrap;
  }

  /* draw doc at time t into stage (a w×h box). opts.render: leave stickers out (the Mac overlays them itself);
     opts.local: use src.file; opts.all: show every layer (for measuring). Returns a key of what's visible. */
  function render(stage, doc, t, opts) {
    opts = opts || {};
    const cache = stage._gzl || (stage._gzl = new Map());
    const seen = new Set(), key = [];
    (doc.layers || []).forEach((L, i) => {
      if (opts.render && L.kind === "sticker") return;
      seen.add(L.id);
      let c = cache.get(L.id);
      const sg = sig(L);
      if (!c || c.sig !== sg) { if (c) c.el.remove(); c = { el: build(L, opts), sig: sg }; cache.set(L.id, c); stage.appendChild(c.el); }
      const z = state(L, t) || (opts.all ? { op: 1, sc: 1, dy: 0 } : null), el = c.el;
      el.style.zIndex = String(i + 1);
      if (!z) { el.style.display = "none"; return; }
      el.style.display = "";
      el.style.opacity = String(z.op);
      el.style.transform = "translate(" + num(L.x, 0) + "px," + (num(L.y, 0) + z.dy) + "px) translate(-50%,-50%) rotate(" + num(L.rot, 0) + "deg) scale(" + num(L.s, 1) * z.sc + ")";
      key.push(L.id + ":" + z.op.toFixed(3) + ":" + z.sc.toFixed(3) + ":" + z.dy.toFixed(1));
    });
    cache.forEach((c, id) => { if (!seen.has(id)) { c.el.remove(); cache.delete(id); } });
    return key.join("|");
  }

  root.GZL = { FONTS, DEF, ANIM_T, fontOf, fontsHref, style, state, captureTimes, render, rgba };
})(typeof window !== "undefined" ? window : globalThis);

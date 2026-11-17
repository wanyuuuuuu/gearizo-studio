/* Gearizo animated scene templates. A "film" is a list of scenes; each scene names a template and fills it in:
     film = {theme:"paper"|"pink", scenes:[{id, tpl:"hook", dur:3.2, trans:"slide"|"zoom"|"wipe", data:{...}}]}
   GZS.render(stage, film, t) draws the frame at time t into a 1080×1920 box. Everything is computed from t (no CSS
   animation), so the app's preview and the frames the Mac captures are identical. Claude only fills in `data`;
   the motion, transitions and look live here. Text may mark a highlight with *stars*. */
(function (root) {
  "use strict";
  const W = 1080, H = 1920, TR = 0.5;
  const THEMES = {
    paper: { name: "工坊纸 Workshop paper", bg: "#F3EEE2", grid: "rgba(31,77,63,.075)", ink: "#1F4D3F", text: "#262A28", sub: "#5A635E",
      accent: "#E8772E", yes: "#2E8B57", no: "#C8314F", card: "#FBF8F1", soft: "#E9E2D2", band: "#2E3230", bandText: "#C9C1AE" },
    pink: { name: "Gearizo 粉", bg: "#FFFFFF", grid: "rgba(236,78,142,.07)", ink: "#125F4E", text: "#0F2A22", sub: "#4A6159",
      accent: "#EC4E8E", yes: "#1E8C6B", no: "#C8314F", card: "#FFF5F9", soft: "#FDE3EE", band: "#1D2B27", bandText: "#C7D3CE" }
  };
  const FONT = "'Poppins','Noto Sans SC','PingFang SC','Hiragino Sans GB',sans-serif";
  const fontsHref = () => "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Noto+Sans+SC:wght@500;700;900&display=block";

  /* ---------- easing and helpers ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const seg = (t, a, b) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
  const E = {
    out: (p) => 1 - Math.pow(1 - p, 3),
    inout: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: (p) => { const c = 1.6; return p <= 0 ? 0 : 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    soft: (p) => 1 - Math.pow(1 - p, 2)
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; }
  const set = (e, tf, op) => { e.style.transform = tf; if (op != null) e.style.opacity = String(clamp(op, 0, 1)); };
  const weight = (s) => [...String(s || "")].reduce((n, c) => n + (/[⺀-鿿＀-￯]/.test(c) ? 1 : 0.56), 0);
  const titleSize = (s, k) => { const w = weight(String(s).replace(/\*/g, "")); return Math.round((w <= 8 ? 150 : w <= 14 ? 128 : w <= 22 ? 108 : w <= 34 ? 92 : 78) * (k || 1)); };
  const bodySize = (s) => (weight(s) <= 50 ? 46 : weight(s) <= 90 ? 41 : 37);

  /* ---------- line icons (100×100, drawn stroke by stroke) ---------- */
  const circ = (cx, cy, r) => `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
  const spokes = (n, r0, r1, rot) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + (rot || 0); return `M${(50 + r0 * Math.cos(a)).toFixed(1)} ${(50 + r0 * Math.sin(a)).toFixed(1)}L${(50 + r1 * Math.cos(a)).toFixed(1)} ${(50 + r1 * Math.sin(a)).toFixed(1)}`; }).join("");
  const ysp = () => Array.from({ length: 5 }, (_, i) => { const a = (i / 5) * Math.PI * 2 - Math.PI / 2, b = 0.22; const p = (r, d) => `${(50 + r * Math.cos(a + d)).toFixed(1)} ${(50 + r * Math.sin(a + d)).toFixed(1)}`; return `M${p(9, 0)}L${p(22, 0)}L${p(34, -b)}M${p(22, 0)}L${p(34, b)}`; }).join("");
  const ICONS = {
    tyre: [circ(50, 50, 44), circ(50, 50, 25), circ(50, 50, 8), "M50 6v9M50 85v9M6 50h9M85 50h9M19 19l6 6M75 75l6 6M81 19l-6 6M25 75l-6 6"],
    tube: [circ(50, 46, 40), circ(50, 46, 26), "M50 86v8M45 94h10"],
    nail: ["M36 14h28", "M50 14v56", "M45 70l5 16l5-16", "M46 32h8M46 44h8"],
    inflator: ["M30 28h40a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8h-40a8 8 0 0 1-8-8v-48a8 8 0 0 1 8-8z", "M36 38h28v18h-28z", circ(50, 74, 6), "M70 32c14-4 22-16 14-26"],
    rimSpoke: [circ(50, 50, 44), circ(50, 50, 38), circ(50, 50, 6), spokes(12, 6, 38, 0.13)],
    rimSport: [circ(50, 50, 44), circ(50, 50, 38), circ(50, 50, 9), ysp()],
    car: ["M10 64v-9c0-4 3-7 7-8l13-3l12-13c2-2 5-3 8-3h18c3 0 6 1 8 4l10 12c6 1 9 4 9 9v11h-8", "M44 31l-5 13h40", circ(30, 66, 9), circ(74, 66, 9), "M39 66h26"],
    motorbike: [circ(22, 66, 14), circ(78, 66, 14), "M22 66l18-24h24l14 24", "M40 42l-6-10h-9", "M64 42l6-14h10", "M44 36h18"],
    wiper: ["M8 82a48 48 0 0 1 84 0", "M50 82l-28-36", "M12 38l20 16"],
    gauge: [circ(50, 54, 38), "M50 20v7M22 38l6 4M78 38l-6 4M16 64h7M84 64h-7", "M50 56l20-22", circ(50, 56, 5)],
    thermo: ["M44 16a6 6 0 0 1 12 0v44a14 14 0 1 1-12 0z", "M50 34v38", "M62 26h8M62 38h8M62 50h8"],
    sticker: ["M18 8v86", "M18 8h56", "M30 30h40v30h-40z", "M36 40h24M36 50h14"],
    warning: ["M50 10l42 76h-84z", "M50 38v22", "M50 70v3"],
    clock: [circ(50, 50, 40), "M50 24v26l16 10"],
    check: ["M20 52l20 20l40-42"],
    cross: ["M28 28l44 44", "M72 28l-44 44"],
    box: ["M18 34l32-15l32 15v40l-32 15l-32-15z", "M18 34l32 15l32-15", "M50 49v40"],
    leak: ["M50 12c14 20 24 32 24 46a24 24 0 0 1-48 0c0-14 10-26 24-46z", "M40 58a10 10 0 0 0 10 10"],
    patch: ["M28 38l28-14l16 32l-28 14z", "M38 40l12 24", "M48 34l12 24"],
    shop: ["M14 42h72v46h-72z", "M10 42l9-24h62l9 24", "M42 88v-26h16v26", "M26 54h10v10h-10zM64 54h10v10h-10z"],
    push: ["M12 50h62", "M58 32l18 18l-18 18"],
    sparkle: ["M50 10v24M50 66v24M10 50h24M66 50h24", "M24 24l10 10M66 66l10 10M76 24l-10 10M34 66l-10 10"],
    phone: ["M32 8h36a6 6 0 0 1 6 6v72a6 6 0 0 1-6 6h-36a6 6 0 0 1-6-6v-72a6 6 0 0 1 6-6z", "M44 82h12"],
    battery: ["M14 32h64v36h-64z", "M78 42h8v16h-8", "M24 42v16M36 42v16M48 42v16"],
    bolt: ["M56 8l-30 48h22l-6 36l32-50h-22z"]
  };
  const ICON_NAMES = Object.keys(ICONS);
  function icon(name, size, color, sw) {
    const s = sv("svg", { viewBox: "0 0 100 100", width: size, height: size, fill: "none", stroke: color, "stroke-width": sw || 4.5, "stroke-linecap": "round", "stroke-linejoin": "round" });
    s.style.overflow = "visible";
    const paths = (ICONS[name] || ICONS.sparkle).flatMap((d) => d.split(/(?=M)/)).map((d) => { const p = sv("path", { d, pathLength: "1", "stroke-dasharray": "1 1", "stroke-dashoffset": "1" }); s.appendChild(p); return p; });
    s._paths = paths;
    return s;
  }
  function drawIcon(s, p) { const n = s._paths.length; s._paths.forEach((x, i) => { const a = (i / n) * 0.55, q = seg(p, a, a + 0.45); x.setAttribute("stroke-dashoffset", String(1 - E.out(q))); }); }

  /* ---------- text with *highlights*, split into words that pop in ---------- */
  function words(text, th, css) {
    const box = el("div", "display:flex;flex-wrap:wrap;justify-content:center;column-gap:.26em;row-gap:.02em;" + (css || ""));
    const toks = [];
    String(text || "").split(/(\*[^*]+\*)/).forEach((part) => {
      const hl = /^\*[^*]+\*$/.test(part), clean = hl ? part.slice(1, -1) : part;
      const pieces = /[⺀-鿿]/.test(clean) && !/\s/.test(clean.trim()) ? (clean.match(/[⺀-鿿＀-￯]{1,2}|[^⺀-鿿＀-￯]+/g) || []) : clean.split(/\s+/);
      pieces.filter((w) => w.trim()).forEach((w) => {
        const sp = el("span", "display:inline-block;position:relative;white-space:nowrap;" + (hl ? "color:" + th.accent + ";" : ""), w);
        if (hl) { const mk = el("i", "position:absolute;left:-.06em;right:-.06em;bottom:.08em;height:.26em;background:" + th.accent + ";opacity:.22;border-radius:.1em;transform-origin:0 50%;transform:scaleX(0);z-index:-1"); sp.appendChild(mk); sp._mk = mk; }
        box.appendChild(sp); toks.push(sp);
      });
    });
    box._toks = toks;
    return box;
  }
  function popWords(box, lt, t0, gap) {
    const toks = box._toks, g = gap == null ? Math.min(0.07, 0.6 / Math.max(1, toks.length)) : gap;
    toks.forEach((sp, i) => { const p = seg(lt, t0 + i * g, t0 + i * g + 0.42); set(sp, "translateY(" + ((1 - E.out(p)) * 46).toFixed(1) + "px) scale(" + (0.8 + 0.2 * E.back(p)).toFixed(3) + ")", p * 2.4); if (sp._mk) sp._mk.style.transform = "scaleX(" + E.out(seg(lt, t0 + toks.length * g + 0.25, t0 + toks.length * g + 0.7)).toFixed(3) + ")"; });
    return t0 + toks.length * g + 0.42;
  }
  const fadeUp = (e, lt, t0, d) => { const p = seg(lt, t0, t0 + (d || 0.5)); set(e, "translateY(" + ((1 - E.out(p)) * 34).toFixed(1) + "px)", p); };
  function pill(text, th, bg, fg) { return el("div", "display:inline-block;font:700 34px/1 " + FONT + ";letter-spacing:.08em;text-transform:uppercase;padding:16px 28px;border-radius:999px;background:" + (bg || th.ink) + ";color:" + (fg || th.card), text); }
  function badge(name, th, size, fill, stroke) {
    const b = el("div", "width:" + size + "px;height:" + size + "px;border-radius:50%;background:" + (fill || th.card) + ";border:5px solid " + (stroke || th.ink) + ";display:flex;align-items:center;justify-content:center;box-shadow:0 18px 40px rgba(0,0,0,.08)");
    const ic = icon(name, Math.round(size * 0.62), stroke || th.ink, 5); b.appendChild(ic); b._ic = ic; return b;
  }
  const column = (css) => el("div", "position:absolute;left:80px;right:80px;top:300px;bottom:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;" + (css || ""));
  const head = (d, th, col) => {
    if (!d.heading && !d.kicker) return null;
    const h = el("div", "display:flex;flex-direction:column;align-items:center;gap:22px");
    if (d.kicker) { h.appendChild(pill(d.kicker, th)); }
    if (d.heading) { const w = words(d.heading, th, "font:800 " + titleSize(d.heading, 0.62) + "px/1.08 " + FONT + ";color:" + th.text + ";max-width:920px"); h.appendChild(w); h._w = w; }
    col.appendChild(h); return h;
  };
  const animHead = (h, lt) => { if (!h) return 0; let e = 0; if (h.firstChild && !h.firstChild._toks) { const p = seg(lt, 0.05, 0.45); set(h.firstChild, "translateX(" + ((1 - E.out(p)) * -60).toFixed(1) + "px)", p); } if (h._w) e = popWords(h._w, lt, 0.12); return e; };
  const times = (n, given, from, to) => Array.from({ length: n }, (_, i) => (given && isFinite(given[i]) ? Number(given[i]) : from + (n <= 1 ? 0 : (i * (to - from)) / (n - 1))));

  /* ---------- the templates ---------- */
  const TPL = {};
  TPL.hook = {
    name: "大标题钩子 Hook title", dur: 3.2, fields: { kicker: "small label (optional)", title: "the hook, *highlight* a word", sub: "one short line under it (optional)", icon: "icon name" },
    use: "Opening line / question that stops the scroll.",
    build(d, th) {
      const c = column("gap:46px"), kick = d.kicker ? pill(d.kicker, th) : null;
      if (kick) c.appendChild(kick);
      const b = d.icon !== "none" ? badge(d.icon || "sparkle", th, 330) : null; if (b) c.appendChild(b);
      const t = words(d.title || "Title", th, "font:800 " + titleSize(d.title) + "px/1.04 " + FONT + ";color:" + th.text + ";max-width:940px"); c.appendChild(t);
      const s = d.sub ? el("div", "font:600 " + bodySize(d.sub) + "px/1.3 " + FONT + ";color:" + th.sub + ";max-width:860px", d.sub) : null; if (s) c.appendChild(s);
      return { root: c, update(lt) {
        if (kick) { const p = seg(lt, 0.0, 0.4); set(kick, "translateY(" + ((1 - E.out(p)) * -30) + "px)", p); }
        if (b) { const p = seg(lt, 0.05, 0.55); set(b, "scale(" + E.back(p).toFixed(3) + ") rotate(" + ((1 - E.out(p)) * -12).toFixed(1) + "deg) translateY(" + (Math.sin(lt * 2.2) * 7).toFixed(1) + "px)", p * 3); drawIcon(b._ic, seg(lt, 0.2, 1.0)); }
        const e = popWords(t, lt, 0.35);
        if (s) fadeUp(s, lt, e - 0.05);
      } };
    }
  };
  TPL.iconText = {
    name: "图标 + 说明 Icon card", dur: 4, fields: { tag: "small label (optional)", icon: "icon name", title: "short title, *highlight* ok", text: "1–2 sentences" },
    use: "Explaining one point. Use several in a row for several points.",
    build(d, th) {
      const c = column();
      const card = el("div", "width:900px;box-sizing:border-box;background:" + th.card + ";border:5px solid " + th.ink + ";border-radius:48px;padding:70px 64px 76px;display:flex;flex-direction:column;align-items:center;gap:36px;box-shadow:0 30px 60px rgba(0,0,0,.08);position:relative");
      const tag = d.tag ? pill(d.tag, th, th.accent, "#fff") : null;
      if (tag) { tag.style.position = "absolute"; tag.style.top = "-30px"; card.appendChild(tag); }
      const b = badge(d.icon || "sparkle", th, 260, th.soft); card.appendChild(b);
      const t = words(d.title || "", th, "font:800 " + titleSize(d.title, 0.72) + "px/1.08 " + FONT + ";color:" + th.text); card.appendChild(t);
      const x = d.text ? el("div", "font:600 " + bodySize(d.text) + "px/1.35 " + FONT + ";color:" + th.sub, d.text) : null; if (x) card.appendChild(x);
      c.appendChild(card);
      return { root: c, update(lt) {
        const p = seg(lt, 0, 0.6); set(card, "translateY(" + ((1 - E.out(p)) * 140).toFixed(1) + "px) rotate(" + ((1 - E.out(p)) * 3).toFixed(2) + "deg)", p * 2);
        if (tag) { const q = seg(lt, 0.45, 0.8); set(tag, "scale(" + E.back(q).toFixed(3) + ")", q * 3); }
        const q = seg(lt, 0.25, 0.7); set(b, "scale(" + E.back(q).toFixed(3) + ") translateY(" + (Math.sin(lt * 2) * 5).toFixed(1) + "px)", q * 3); drawIcon(b._ic, seg(lt, 0.4, 1.2));
        const e = popWords(t, lt, 0.6);
        if (x) fadeUp(x, lt, e - 0.1, 0.6);
      } };
    }
  };
  TPL.lens = {
    name: "放大镜看字 Magnifier", dur: 5, fields: { heading: "title above (optional)", band: "the text printed on the tyre/box, e.g. 80/90-14 M/C 46P TUBELESS", word: "the word to zoom on (must be in band)", label: "what it means, *highlight* ok", text: "extra line (optional)" },
    use: "Pointing at small print: tyre sidewall markings, labels, codes.",
    build(d, th) {
      const r = el("div", "position:absolute;inset:0");
      const c = column("justify-content:flex-start;top:330px;gap:0"); const h = head(d, th, c); r.appendChild(c);
      const arc = sv("svg", { viewBox: "0 0 1080 420", width: 1080, height: 420 }); arc.style.cssText = "position:absolute;left:0;top:660px;overflow:visible";
      const a1 = sv("path", { d: "M-40 300 Q540 40 1120 300", fill: "none", stroke: th.ink, "stroke-width": 6, "stroke-linecap": "round", pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1, opacity: .35 });
      const a2 = sv("path", { d: "M-40 380 Q540 120 1120 380", fill: "none", stroke: th.ink, "stroke-width": 6, "stroke-linecap": "round", pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1, opacity: .35 });
      arc.appendChild(a1); arc.appendChild(a2); r.appendChild(arc);
      const band = el("div", "position:absolute;left:50px;width:980px;top:860px;height:190px;border-radius:30px;background:" + th.band + ";display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:inset 0 6px 0 rgba(255,255,255,.06),0 24px 50px rgba(0,0,0,.18)");
      const mk = (into) => { const line = el("div", "display:flex;gap:26px;font:800 50px/1 " + FONT + ";letter-spacing:.06em;color:" + th.bandText + ";white-space:nowrap"); let tgt = null; String(d.band || "MICHELIN TUBELESS").split(/\s+/).forEach((w) => { const s = el("span", "", w); if (!tgt && d.word && w.toUpperCase().includes(String(d.word).toUpperCase())) tgt = s; line.appendChild(s); }); into.appendChild(line); return { line, tgt }; };
      const main = mk(band); r.appendChild(band);
      const R = 165, S = 2.1;
      const lens = el("div", "position:absolute;left:0;top:0;width:" + 2 * R + "px;height:" + 2 * R + "px;z-index:3");
      const glass = el("div", "position:absolute;inset:0;border-radius:50%;overflow:hidden;background:" + th.band + ";border:14px solid " + th.ink + ";box-sizing:border-box;box-shadow:0 26px 50px rgba(0,0,0,.25)");
      const inner = el("div", "position:absolute;left:0;top:0;width:980px;height:190px;display:flex;align-items:center;justify-content:center;transform-origin:0 0");
      const zoom = mk(inner); glass.appendChild(inner);
      const shine = el("div", "position:absolute;left:18%;top:12%;width:34%;height:20%;border-radius:50%;background:rgba(255,255,255,.18);transform:rotate(-30deg)"); glass.appendChild(shine);
      const handle = el("div", "position:absolute;left:" + (2 * R - 40) + "px;top:" + (2 * R - 40) + "px;width:150px;height:44px;border-radius:22px;background:" + th.ink + ";transform-origin:0 50%;transform:rotate(45deg)");
      lens.appendChild(handle); lens.appendChild(glass); r.appendChild(lens);
      const call = el("div", "position:absolute;left:90px;right:90px;top:1300px;display:flex;flex-direction:column;align-items:center;gap:26px;text-align:center");
      const lab = words(d.label || "", th, "font:800 " + titleSize(d.label, 0.66) + "px/1.1 " + FONT + ";color:" + th.text);
      const labBox = el("div", "background:" + th.card + ";border:5px solid " + th.accent + ";border-radius:36px;padding:34px 44px"); labBox.appendChild(lab); call.appendChild(labBox);
      const x = d.text ? el("div", "font:600 " + bodySize(d.text) + "px/1.35 " + FONT + ";color:" + th.sub, d.text) : null; if (x) call.appendChild(x);
      r.appendChild(call);
      return { root: r, update(lt) {
        animHead(h, lt);
        a1.setAttribute("stroke-dashoffset", String(1 - E.out(seg(lt, 0, 0.8)))); a2.setAttribute("stroke-dashoffset", String(1 - E.out(seg(lt, 0.1, 0.9))));
        const bp = seg(lt, 0.15, 0.65); set(band, "scaleX(" + (0.6 + 0.4 * E.out(bp)).toFixed(3) + ")", bp * 2);
        if (!this._fit && main.line.scrollWidth) { const k = Math.min(1, 900 / main.line.scrollWidth); [main.line, zoom.line].forEach((l) => { l.style.fontSize = (50 * k).toFixed(1) + "px"; l.style.gap = (26 * k).toFixed(1) + "px"; }); this._fit = document.fonts ? document.fonts.status === "loaded" : true; }
        // where the word is (measured live, so any font/length works)
        const tg = main.tgt || main.line.lastChild, bl = band.offsetLeft, bt = band.offsetTop;
        const wx = bl + tg.offsetLeft + tg.offsetWidth / 2, wy = bt + band.offsetHeight / 2;   // spans are positioned against the band
        const mp = E.inout(seg(lt, 0.7, 1.6)), lx = 1260 + (wx - 1260) * mp, ly = 1480 + (wy - 1480) * mp - Math.sin(mp * Math.PI) * 180;
        set(lens, "translate(" + (lx - R).toFixed(1) + "px," + (ly - R).toFixed(1) + "px) rotate(" + ((1 - mp) * 25).toFixed(1) + "deg)", seg(lt, 0.7, 0.9) * 1.4);
        const inR = R - 14;
        inner.style.transform = "translate(" + (inR - (lx - bl) * S).toFixed(1) + "px," + (inR - (ly - bt) * S).toFixed(1) + "px) scale(" + S + ")";
        const hit = seg(lt, 1.55, 1.85);
        [main.tgt, zoom.tgt].forEach((s) => { if (s) s.style.color = hit > 0 ? th.accent : th.bandText; });
        if (zoom.tgt) zoom.tgt.style.textShadow = hit > 0 ? "0 0 18px " + th.accent : "none";
        const cp = seg(lt, 1.8, 2.3); set(labBox, "scale(" + E.back(cp).toFixed(3) + ")", cp * 3); popWords(lab, lt, 1.95);
        if (x) fadeUp(x, lt, 2.4);
      } };
    }
  };
  TPL.compare = {
    name: "左右对比 Compare", dur: 5, fields: { heading: "title (optional)", left: "{icon,title,text,mark: yes|no|''}", right: "{icon,title,text,mark}" },
    use: "Two options side by side, optionally right ✓ / wrong ✗.",
    build(d, th) {
      const r = el("div", "position:absolute;inset:0");
      const c = column("justify-content:flex-start;top:330px"); const h = head(d, th, c); r.appendChild(c);
      const sides = ["left", "right"].map((k, i) => {
        const s = d[k] || {}, card = el("div", "position:absolute;top:" + (d.heading ? 760 : 620) + "px;left:" + (i ? 560 : 60) + "px;width:460px;height:780px;box-sizing:border-box;background:" + th.card + ";border:5px solid " + th.ink + ";border-radius:44px;padding:64px 36px;display:flex;flex-direction:column;align-items:center;gap:30px;text-align:center;box-shadow:0 26px 50px rgba(0,0,0,.08)");
        const b = badge(s.icon || "sparkle", th, 230, th.soft); card.appendChild(b);
        const longest = Math.max(...String(s.title || "").replace(/\*/g, "").split(/\s+/).map(weight), 1);
        const t = words(s.title || "", th, "font:800 " + Math.round(Math.min(74, titleSize(s.title, 0.6), 370 / (longest * 1.05))) + "px/1.08 " + FONT + ";color:" + th.text); card.appendChild(t);
        const x = s.text ? el("div", "font:600 " + Math.min(40, bodySize(s.text)) + "px/1.32 " + FONT + ";color:" + th.sub, s.text) : null; if (x) card.appendChild(x);
        let m = null;
        if (s.mark === "yes" || s.mark === "no") { m = el("div", "position:absolute;right:-26px;top:-36px;width:140px;height:140px;border-radius:50%;background:" + (s.mark === "yes" ? th.yes : th.no) + ";display:flex;align-items:center;justify-content:center;box-shadow:0 14px 30px rgba(0,0,0,.2)"); const ic = icon(s.mark === "yes" ? "check" : "cross", 92, "#fff", 11); m.appendChild(ic); m._ic = ic; card.appendChild(m); }
        r.appendChild(card);
        return { card, b, t, x, m, mark: s.mark };
      });
      const vs = el("div", "position:absolute;left:470px;width:140px;height:140px;top:" + ((d.heading ? 760 : 620) + 109) + "px;border-radius:50%;background:" + th.accent + ";color:#fff;font:800 50px/140px " + FONT + ";text-align:center;z-index:2;box-shadow:0 12px 30px rgba(0,0,0,.18)", "VS");
      r.appendChild(vs);
      return { root: r, update(lt) {
        animHead(h, lt);
        sides.forEach((s, i) => {
          const p = seg(lt, 0.15 + i * 0.15, 0.75 + i * 0.15); set(s.card, "translateX(" + ((1 - E.out(p)) * (i ? 700 : -700)).toFixed(1) + "px) rotate(" + ((1 - E.out(p)) * (i ? 6 : -6)).toFixed(1) + "deg)", p * 2);
          const q = seg(lt, 0.55 + i * 0.15, 1.0 + i * 0.15); set(s.b, "scale(" + E.back(q).toFixed(3) + ")", q * 3); drawIcon(s.b._ic, seg(lt, 0.65 + i * 0.15, 1.4 + i * 0.15));
          const e = popWords(s.t, lt, 0.8 + i * 0.15); if (s.x) fadeUp(s.x, lt, e - 0.1);
          if (s.m) { const mt = 1.7 + i * 0.35, mp = seg(lt, mt, mt + 0.35); set(s.m, "scale(" + (mp > 0 ? 2.2 - 1.2 * E.back(mp) : 0).toFixed(3) + ") rotate(" + ((1 - E.out(mp)) * -20).toFixed(1) + "deg)", mp * 3); drawIcon(s.m._ic, seg(lt, mt + 0.1, mt + 0.5)); }
          const dim = s.mark === "no" ? seg(lt, 2.4, 2.8) : 0; s.card.style.filter = dim ? "grayscale(" + dim * 0.7 + ")" : ""; if (dim) s.card.style.opacity = String(1 - dim * 0.35);
        });
        const v = seg(lt, 0.6, 1.0); set(vs, "scale(" + E.back(v).toFixed(3) + ") rotate(" + ((1 - E.out(v)) * 90).toFixed(1) + "deg)", v * 3);
      } };
    }
  };
  TPL.steps = {
    name: "1-2-3 步骤 Steps", dur: 6, fields: { heading: "title", steps: "[{icon (optional), text}] 2–5 steps", times: "[seconds into the scene when each step appears] (optional, for VO)" },
    use: "How-to sequences: do this, then this.",
    build(d, th) {
      const r = el("div", "position:absolute;inset:0");
      const c = column("justify-content:flex-start;top:330px"); const h = head(d, th, c); r.appendChild(c);
      const st = (d.steps || []).slice(0, 5), top0 = d.heading ? 720 : 560, gap = Math.min(250, 900 / Math.max(1, st.length));
      const line = el("div", "position:absolute;left:182px;width:8px;border-radius:4px;background:" + th.ink + ";opacity:.25;top:" + (top0 + 60) + "px;height:" + Math.max(0, (st.length - 1) * gap) + "px;transform-origin:50% 0"); r.appendChild(line);
      const rows = st.map((s, i) => {
        const row = el("div", "position:absolute;left:120px;right:70px;top:" + (top0 + i * gap) + "px;display:flex;align-items:center;gap:40px");
        const n = el("div", "flex:none;width:132px;height:132px;border-radius:50%;background:" + th.ink + ";color:" + th.card + ";font:800 64px/132px " + FONT + ";text-align:center;box-shadow:0 12px 26px rgba(0,0,0,.12)", String(i + 1));
        const box = el("div", "flex:1;display:flex;align-items:center;gap:26px;background:" + th.card + ";border-radius:30px;padding:26px 30px;border:4px solid transparent;min-height:120px;box-sizing:border-box");
        const ic = s.icon ? icon(s.icon, 92, th.ink, 6) : null; if (ic) box.appendChild(ic);
        const tx = el("div", "font:700 " + Math.min(50, bodySize(s.text) + 4) + "px/1.25 " + FONT + ";color:" + th.text + ";text-align:left", s.text || ""); box.appendChild(tx);
        row.appendChild(n); row.appendChild(box); r.appendChild(row);
        return { row, n, box, ic };
      });
      const at = times(rows.length, d.times, 0.7, Math.max(1.2, (d.dur || 6) - 1.6));
      return { root: r, update(lt) {
        animHead(h, lt);
        let cur = -1; at.forEach((t0, i) => { if (lt >= t0) cur = i; });
        const n1 = Math.max(1, rows.length - 1), fr = cur <= 0 ? 0 : ((cur - 1) + E.out(seg(lt, at[cur], at[cur] + 0.45))) / n1;
        line.style.transform = "scaleY(" + fr.toFixed(3) + ")";
        rows.forEach((x, i) => {
          const p = seg(lt, at[i], at[i] + 0.5);
          set(x.row, "translateX(" + ((1 - E.out(p)) * 120).toFixed(1) + "px)", p * 2);
          set(x.n, "scale(" + E.back(seg(lt, at[i], at[i] + 0.45)).toFixed(3) + ")");
          const on = i === cur; x.n.style.background = on ? th.accent : th.ink; x.box.style.borderColor = on ? th.accent : "transparent";
          if (x.ic) drawIcon(x.ic, seg(lt, at[i] + 0.15, at[i] + 0.9));
        });
      } };
    }
  };
  TPL.stop = {
    name: "警告清单 Stop list", dur: 6, fields: { heading: "warning title, e.g. JANGAN TUNGGANG JIKA:", items: "[short lines] 2–6", times: "[seconds when each appears] (optional)" },
    use: "Don'ts, danger signs, when to stop / call for help.",
    build(d, th) {
      const r = el("div", "position:absolute;inset:0");
      const ban = el("div", "position:absolute;left:70px;right:70px;top:340px;background:" + th.no + ";border-radius:40px;padding:40px 44px;display:flex;align-items:center;gap:30px;box-shadow:0 22px 50px rgba(200,49,79,.3)");
      const wi = icon("warning", 130, "#fff", 8); ban.appendChild(wi);
      const ht = el("div", "font:800 " + Math.min(76, titleSize(d.heading, 0.55)) + "px/1.08 " + FONT + ";color:#fff;text-align:left", d.heading || "STOP"); ban.appendChild(ht);
      r.appendChild(ban);
      const it = (d.items || []).slice(0, 6), gap = Math.min(190, 1000 / Math.max(1, it.length));
      const rows = it.map((s, i) => {
        const row = el("div", "position:absolute;left:90px;right:90px;top:" + (690 + i * gap) + "px;display:flex;align-items:center;gap:30px;background:" + th.card + ";border-radius:28px;padding:22px 28px;box-shadow:0 10px 24px rgba(0,0,0,.06)");
        const m = el("div", "flex:none;width:96px;height:96px;border-radius:50%;background:" + th.no + ";display:flex;align-items:center;justify-content:center");
        const ic = icon("cross", 60, "#fff", 12); m.appendChild(ic);
        row.appendChild(m); row.appendChild(el("div", "font:700 " + Math.min(50, bodySize(s) + 4) + "px/1.22 " + FONT + ";color:" + th.text, s));
        r.appendChild(row); return { row, m, ic };
      });
      const at = times(rows.length, d.times, 0.9, Math.max(1.4, (d.dur || 6) - 1.4));
      return { root: r, update(lt) {
        const p = seg(lt, 0, 0.55); set(ban, "translateY(" + ((1 - E.back(p)) * -260).toFixed(1) + "px)", p * 3);
        const sh = seg(lt, 0.5, 1.1); wi.style.transform = "rotate(" + (Math.sin(sh * Math.PI * 6) * 14 * (1 - sh)).toFixed(1) + "deg)"; drawIcon(wi, seg(lt, 0.2, 0.8));
        rows.forEach((x, i) => { const q = seg(lt, at[i], at[i] + 0.45); set(x.row, "translateX(" + ((1 - E.back(q)) * 700).toFixed(1) + "px)", q * 2); set(x.m, "scale(" + E.back(seg(lt, at[i] + 0.15, at[i] + 0.5)).toFixed(3) + ")"); drawIcon(x.ic, seg(lt, at[i] + 0.25, at[i] + 0.6)); });
      } };
    }
  };
  TPL.endcard = {
    name: "产品结尾卡 Product end card", dur: 5, fields: { image: "product photo with transparent background (url/path)", logo: "logo url (default Gearizo)", title: "tagline, *highlight* ok", sub: "product name / one line (optional)", cta: "button text, e.g. SAVE & SHARE (optional)" },
    use: "The last scene: product, logo, tagline, call to action.",
    build(d, th, ctx) {
      const r = el("div", "position:absolute;inset:0");
      const rings = sv("svg", { viewBox: "0 0 1000 1000", width: 1000, height: 1000 }); rings.style.cssText = "position:absolute;left:40px;top:240px;overflow:visible";
      const r1 = sv("circle", { cx: 500, cy: 500, r: 400, fill: "none", stroke: th.ink, "stroke-width": 4, opacity: .22, pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1 });
      const r2 = sv("circle", { cx: 500, cy: 500, r: 455, fill: "none", stroke: th.accent, "stroke-width": 5, opacity: .5, "stroke-dasharray": "6 22", "stroke-linecap": "round" });
      rings.appendChild(r1); rings.appendChild(r2); r.appendChild(rings);
      const shadow = el("div", "position:absolute;left:290px;top:1090px;width:500px;height:70px;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.28),rgba(0,0,0,0))"); r.appendChild(shadow);
      let prod;
      if (d.image) { prod = el("img", "position:absolute;left:190px;top:330px;width:700px;height:760px;object-fit:contain"); prod.alt = ""; prod.setAttribute("src", ctx.url(d.image)); }
      else { prod = el("div", "position:absolute;left:290px;top:430px;width:500px;height:560px;display:flex;align-items:center;justify-content:center"); const ic = icon("inflator", 460, th.ink, 4); prod.appendChild(ic); prod._ic = ic; }
      r.appendChild(prod);
      const low = el("div", "position:absolute;left:80px;right:80px;top:1210px;display:flex;flex-direction:column;align-items:center;gap:26px;text-align:center");
      const logo = d.logo === "none" ? null : el("img", "width:380px;height:auto;display:block;margin-bottom:6px"); if (logo) { logo.alt = ""; logo.setAttribute("src", ctx.url(d.logo || "brand/gearizo-logo.png")); low.appendChild(logo); }
      const t = words(d.title || "", th, "font:800 " + titleSize(d.title, 0.8) + "px/1.06 " + FONT + ";color:" + th.text + ";max-width:920px"); low.appendChild(t);
      const s = d.sub ? el("div", "font:600 " + bodySize(d.sub) + "px/1.3 " + FONT + ";color:" + th.sub, d.sub) : null; if (s) low.appendChild(s);
      const cta = d.cta ? el("div", "margin-top:14px;font:800 42px/1 " + FONT + ";letter-spacing:.08em;color:#fff;background:" + th.accent + ";padding:26px 46px;border-radius:999px;box-shadow:0 16px 34px rgba(0,0,0,.16)", d.cta) : null; if (cta) low.appendChild(cta);
      r.appendChild(low);
      return { root: r, update(lt, dur) {
        r1.setAttribute("stroke-dashoffset", String(1 - E.out(seg(lt, 0, 1.0))));
        rings.style.transform = "rotate(" + (lt * 9).toFixed(2) + "deg)"; rings.style.transformOrigin = "500px 500px"; r2.style.opacity = String(0.5 * seg(lt, 0.2, 0.8));
        const p = seg(lt, 0.15, 0.9), fl = lt > 0.9 ? Math.sin((lt - 0.9) * 2.3) * 14 : 0;
        set(prod, "translateY(" + ((1 - E.back(p)) * 380 + fl).toFixed(1) + "px) scale(" + (0.82 + 0.18 * E.out(p)).toFixed(3) + ")", p * 2.5);
        if (prod._ic) drawIcon(prod._ic, seg(lt, 0.2, 1.2));
        set(shadow, "scale(" + (0.6 + 0.4 * E.out(p) - fl / 160).toFixed(3) + ")", p * (0.9 - fl / 60));
        if (logo) fadeUp(logo, lt, 0.75);
        const e = popWords(t, lt, 1.0);
        if (s) fadeUp(s, lt, e - 0.1);
        if (cta) { const ct = Math.max(e + 0.2, dur - 1.6), q = seg(lt, ct, ct + 0.45), pulse = lt > ct + 0.6 ? 1 + Math.sin((lt - ct) * 6) * 0.03 : 1; set(cta, "scale(" + (E.back(q) * pulse).toFixed(3) + ")", q * 3); }
      } };
    }
  };

  /* ---------- the film ---------- */
  const filmDur = (film) => ((film && film.scenes) || []).reduce((n, s) => n + Math.max(0.6, Number(s.dur) || (TPL[s.tpl] || {}).dur || 3), 0);
  function bg(th) {
    const b = el("div", "position:absolute;inset:-80px;background-color:" + th.bg + ";background-image:linear-gradient(" + th.grid + " 2px,transparent 2px),linear-gradient(90deg," + th.grid + " 2px,transparent 2px);background-size:60px 60px");
    const v = el("div", "position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,rgba(255,255,255,0) 55%,rgba(0,0,0,.07) 100%)");
    const w = el("div", "position:absolute;inset:0;overflow:hidden"); w.appendChild(b); w.appendChild(v); w._g = b; return w;
  }
  function render(stage, film, t, opts) {
    opts = opts || {};
    const th = THEMES[film.theme] || THEMES.paper;
    let st = stage._gzs;
    const sig = JSON.stringify([film.theme, film.scenes]);
    if (!st || st.sig !== sig) {
      if (st) st.root.remove();
      const root = el("div", "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;overflow:hidden");
      const back = bg(th); root.appendChild(back);
      const ctx = { url: opts.url || ((u) => u) };
      let s0 = 0;
      const scenes = (film.scenes || []).map((s) => {
        const T = TPL[s.tpl] || TPL.iconText, dur = Math.max(0.6, Number(s.dur) || T.dur);
        const wrap = el("div", "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;will-change:transform,opacity");
        const inst = T.build(Object.assign({ dur }, s.data || {}), th, ctx); wrap.appendChild(inst.root); root.appendChild(wrap);
        const o = { s, wrap, inst, start: s0, dur, trans: s.trans || "slide" }; s0 += dur; return o;
      });
      const bar = el("div", "position:absolute;top:0;bottom:0;width:16px;background:" + th.accent + ";display:none;z-index:9"); root.appendChild(bar);
      stage.appendChild(root);
      st = stage._gzs = { sig, root, back, scenes, bar };
    }
    st.back._g.style.transform = "translate(" + (-(t * 9) % 60).toFixed(1) + "px," + (-(t * 5) % 60).toFixed(1) + "px)";
    st.bar.style.display = "none";
    st.scenes.forEach((o, i) => {
      const next = st.scenes[i + 1], end = o.start + o.dur;
      const inWin = i > 0 && t >= o.start - TR && t < o.start, live = t >= o.start && t < end, show = live || inWin || (opts.all && i === 0);
      o.wrap.style.display = show ? "" : "none";
      if (!show) return;
      o.wrap.style.clipPath = ""; o.wrap.style.filter = "";
      let tf = "none", op = 1;
      if (inWin) {                                   // coming in (its own animation waits until it's fully in)
        const e = E.inout(seg(t, o.start - TR, o.start));
        if (o.trans === "zoom") { tf = "scale(" + (0.9 + 0.1 * e).toFixed(4) + ")"; op = e; }
        else if (o.trans === "wipe") { o.wrap.style.clipPath = "inset(0 " + ((1 - e) * 100).toFixed(2) + "% 0 0)"; st.bar.style.display = e > 0 && e < 1 ? "" : "none"; st.bar.style.left = (e * W - 8).toFixed(1) + "px"; }
        else tf = "translateX(" + ((1 - e) * W).toFixed(1) + "px)";
        o.wrap.style.zIndex = "2";
        o.inst.update(t - o.start + TR, o.dur);
      } else {
        o.wrap.style.zIndex = "1";
        if (next && t >= end - TR) {                 // going out
          const e = E.inout(seg(t, end - TR, end));
          if (next.trans === "zoom") { tf = "scale(" + (1 + 0.14 * e).toFixed(4) + ")"; op = 1 - e; o.wrap.style.filter = "blur(" + (e * 10).toFixed(1) + "px)"; }
          else if (next.trans === "wipe") { o.wrap.style.clipPath = "inset(0 0 0 " + (e * 100).toFixed(2) + "%)"; }
          else tf = "translateX(" + (-e * W).toFixed(1) + "px)";
        }
        o.inst.update(t - o.start + (i > 0 ? TR : 0), o.dur);
      }
      o.wrap.style.transform = tf; o.wrap.style.opacity = String(op);
    });
  }
  const catalog = () => Object.keys(TPL).map((k) => ({ id: k, name: TPL[k].name, dur: TPL[k].dur, use: TPL[k].use, fields: TPL[k].fields }));

  root.GZS = { W, H, TR, THEMES, ICONS: ICON_NAMES, TPL, fontsHref, filmDur, render, catalog };
})(typeof window !== "undefined" ? window : globalThis);

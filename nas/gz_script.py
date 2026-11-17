#!/usr/bin/env python3
"""Gearizo: Claude writes a video's script and storyboard on this Mac (Claude Code, no API key).

In the app, a video's Script tab sets docs/scripts/<item id>.gen.state = "queued" (with optional length, language and
"what you want" notes). Every NAS-job run, handle_scripts() picks those up, asks `claude -p` for a script + shot list +
prompts as JSON, and writes it back. The series' style and characters (docs/settings/series:<id>) go into every prompt
so a series keeps one look.

  python3 gz_script.py test <GZ code>    write a script for that video here and print it (doesn't save)
"""
import json, os, re, shutil, subprocess, sys, time, traceback
from glob import glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settings as S  # noqa: E402

SERIES = {"garage": "Garage Notes", "trend": "Trend", "product": "Product", "graphic": "Graphic", "festival": "Festival"}
LANG = {"en": "English", "manglish": "Manglish (Malaysian English, casual, with lah/leh where natural)", "bm": "Bahasa Melayu", "zh": "Simplified Chinese (Malaysian Chinese way of speaking)"}
PLAT = {"reel": "Instagram Reels", "fb": "Facebook", "tiktok": "TikTok", "tt_gz": "TikTok", "tt_my": "TikTok", "tt_sg": "TikTok",
        "story": "Instagram Story", "carousel": "Instagram carousel", "shop": "Shopee"}

SYSTEM = """You are the script writer for Gearizo, the officially authorised Michelin Lifestyle car-accessories distributor for
Malaysia and Singapore. You write short vertical videos (9:16) for Instagram Reels, Facebook and TikTok: punchy hooks,
one clear takeaway, local Malaysian flavour, never cringe, never fake claims about products.

You return ONE JSON object and nothing else (no markdown, no commentary). Schema:
{
 "title": string,                       // working title
 "length": number,                      // total seconds
 "lang": string,                        // language of the spoken lines
 "style": string,                       // e.g. "3D cartoon", "real people 口播", "motion graphics"
 "cover": string,                       // cover/hook text, short, in caps if English
 "summary": string,                     // 1-3 sentences: the idea and the takeaways
 "prep": [string],                      // "before you start" notes for the maker (references to make, products to photograph...)
 "lines": [{"t": "0–2s", "who": string, "line": string}],   // the full spoken script with timings; who = character, Host, VO, or "—"
 "shots": [{
   "n": "S1", "t": "0–2s",
   "kind": "AI" | "REAL" | "PRODUCT" | "DIAGRAM" | "CARD",  // AI = generate with an AI video tool; REAL = film it; PRODUCT = real product shot / image-to-video from a product photo; DIAGRAM/CARD = made in editing
   "desc": string,                      // what happens, in the video's working language (English unless asked)
   "first": string,                     // AI/PRODUCT only: first-frame image prompt in Chinese, ending with the series style words
   "motion": string,                    // AI/PRODUCT only: motion prompt in Chinese, with the duration ("…，2秒")
   "text": string                       // on-screen text / numbers / logos added in editing ("" if none)
 }]
}
Rules:
- Timings in lines and shots line up and add up to "length". Each AI shot is 2–5 s (AI clips are short).
- AI prompts never ask the AI to draw readable text, numbers or logos: those go in "text" and are added in editing.
- Characters are called by name only in prompts (the maker uploads their reference sheets); describe action, place, camera, light.
- Every "first" prompt ends with the series style words exactly as given.
- For real-people (口播) videos: shots are REAL/PRODUCT with camera direction in "desc"; "first"/"motion" stay "".
- If a current script is given, rewrite it following the request and keep what works."""

EXAMPLE = {"title": "When to check tyre pressure", "length": 18, "lang": "English", "style": "3D cartoon",
           "cover": "YOU CHECK TYRE PRESSURE WRONG",
           "summary": "Two takeaways: check pressure when the tyres are cold, and use the door sticker, not the sidewall.",
           "prep": ["Upload both 3D character sheets (Jay, Uncle Lim) as references in every generation.",
                    "Use image-to-video with a real photo of the inflator for S5."],
           "lines": [{"t": "0–2s", "who": "Jay", "line": "Time to check my tyre pressure!"},
                     {"t": "2–6s", "who": "Uncle Lim", "line": "Not now. Hot tyres give a higher reading."}],
           "shots": [{"n": "S1", "t": "0–2s", "kind": "AI", "desc": "Hook. Petrol station at dusk. Jay hurries to the front wheel with a tyre gauge.",
                      "first": "马来西亚油站，傍晚橘色天空，Jay，刚从白色掀背车下来，手拿一个小型胎压计，一脸自信，中景，3D卡通动画风格，C4D渲染，色彩明亮温暖，竖屏构图，高清",
                      "motion": "Jay快步走向前轮并蹲下，镜头跟随，2秒，轻快", "text": "Cover: YOU CHECK TYRE PRESSURE WRONG"},
                     {"t": "10–13s", "n": "S4", "kind": "DIAGRAM", "desc": "Split screen: door sticker (tick) vs sidewall MAX number (cross).",
                      "first": "", "motion": "", "text": "✓ Door sticker  ✗ Sidewall MAX"}]}


def claude_path():
    c = S.CFG.get("claude") or shutil.which("claude")
    if c:
        return c
    for p in [os.path.expanduser("~/.local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"] + sorted(glob(os.path.expanduser("~/.nvm/versions/node/*/bin/claude"))):
        if os.path.isfile(p):
            return p
    raise RuntimeError("Claude Code isn't installed on this Mac")


def build_prompt(it, series, req, current):
    sid = it.get("series", "")
    langs = [LANG.get(x, x) for x in (req.get("langs") or it.get("langs") or [])] or ["English"]
    kind = {"ai": "AI-generated video", "real": "real people / 口播 (filmed)"}.get(it.get("kind", ""), "not decided (pick what suits)")
    p = ["VIDEO TO WRITE", "Title / idea: " + (it.get("title") or ""), "Code: " + (it.get("code") or ""),
         "Series: " + SERIES.get(sid, sid or "none"), "Type: " + kind,
         "Platforms: " + (", ".join(sorted({PLAT.get(x, x) for x in it.get("platforms") or []})) or "Reels, TikTok, Facebook"),
         "Spoken language: " + " + ".join(langs),
         "Target length: " + (str(req.get("length")) + " seconds" if req.get("length") else "15–30 seconds, whatever the idea needs")]
    if it.get("product"):
        p.append("Product: " + it["product"])
    if (it.get("notes") or "").strip():
        p.append("Planner's notes / idea:\n" + it["notes"].strip()[:3000])
    if series:
        p.append("\nSERIES BIBLE (" + SERIES.get(sid, sid) + ")")
        if series.get("style"):
            p.append("Style words to end every first-frame prompt with: " + series["style"].strip())
        for ch in series.get("characters") or []:
            if ch.get("name"):
                p.append("Character " + ch["name"] + ": " + (ch.get("desc") or "").strip()[:800])
        if (series.get("notes") or "").strip():
            p.append("Series notes: " + series["notes"].strip()[:2000])
    if current and (current.get("lines") or current.get("shots")):
        keep = {k: current.get(k) for k in ("title", "length", "lang", "style", "cover", "summary", "prep", "lines", "shots")}
        for s in keep.get("shots") or []:
            s.pop("clip", None)
        p.append("\nCURRENT SCRIPT (rewrite it):\n" + json.dumps(keep, ensure_ascii=False)[:12000])
    if (req.get("steer") or "").strip():
        p.append("\nWHAT THE TEAM ASKS FOR: " + req["steer"].strip()[:1500])
    p.append("\nFORMAT EXAMPLE (shortened; yours is complete):\n" + json.dumps(EXAMPLE, ensure_ascii=False))
    p.append("\nReturn only the JSON object.")
    return "\n".join(p)


def ask_claude(prompt, system=None):
    cmd = [claude_path(), "-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--strict-mcp-config",
           "--setting-sources", "", "--system-prompt", system or SYSTEM]
    env = dict(os.environ, PATH=os.path.dirname(claude_path()) + ":" + os.environ.get("PATH", "/usr/bin:/bin"))
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=900, cwd=os.path.expanduser("~"), env=env)
    try:
        out = json.loads(r.stdout)
    except Exception:
        raise RuntimeError((r.stderr or r.stdout or "Claude gave no answer").strip()[-300:])
    if out.get("is_error"):
        msg = str(out.get("result") or "Claude failed")
        if re.search(r"authenticat|login|OAuth", msg, re.I):
            msg = "Claude Code on the Mac needs signing in again (open Terminal, type claude, sign in). " + msg
        raise RuntimeError(msg[:300])
    text = str(out.get("result") or "").strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise RuntimeError("Claude's answer wasn't a script: " + text[:200])
    return json.loads(m.group(0))


def clean(d):
    """Keep only the fields the app shows, with sane types and sizes."""
    s = lambda v, n=2000: str(v if v is not None else "")[:n]
    kinds = {"AI", "REAL", "PRODUCT", "DIAGRAM", "CARD"}
    shots = []
    for i, x in enumerate((d.get("shots") or [])[:40]):
        k = s(x.get("kind"), 10).upper()
        shots.append({"n": s(x.get("n") or f"S{i + 1}", 8), "t": s(x.get("t"), 20), "kind": k if k in kinds else "AI", "desc": s(x.get("desc")),
                      "first": s(x.get("first")), "motion": s(x.get("motion")), "text": s(x.get("text"), 600)})
    try:
        length = round(float(d.get("length") or 0), 1)
    except (TypeError, ValueError):
        length = 0
    return {"title": s(d.get("title"), 200), "length": length, "lang": s(d.get("lang"), 60), "style": s(d.get("style"), 80),
            "cover": s(d.get("cover"), 200), "summary": s(d.get("summary"), 1500),
            "prep": [s(x, 600) for x in (d.get("prep") or [])[:12]],
            "lines": [{"t": s(x.get("t"), 20), "who": s(x.get("who"), 40), "line": s(x.get("line"), 1000)} for x in (d.get("lines") or [])[:80]],
            "shots": shots}


def handle_scripts(docs, merge, log, items=None):
    rows = docs("scripts")
    todo = [(k, v) for k, v in rows.items() if (v.get("gen") or {}).get("state") == "queued"]
    if not todo:
        return
    items = items if items is not None else docs("items")
    settings = docs("settings")
    for item_id, d in todo[:2]:
        g = d.get("gen") or {}
        it = items.get(item_id)
        now = lambda: int(time.time() * 1000)
        if not it:
            merge("scripts", item_id, {"gen": dict(g, state="failed", error="The video isn't in the app any more.", doneAt=now())})
            continue
        merge("scripts", item_id, {"gen": dict(g, state="writing", startedAt=now())})
        t0 = time.time()
        try:
            series = settings.get("series:" + (it.get("series") or ""), {})
            out = clean(ask_claude(build_prompt(it, series, g, d if g.get("rewrite") else None)))
            if not out["lines"] and not out["shots"]:
                raise RuntimeError("Claude returned an empty script")
            old = {x.get("n"): x.get("clip") for x in d.get("shots") or [] if x.get("clip")}
            for x in out["shots"]:                      # uploaded clips stay with their shot
                if old.get(x["n"]):
                    x["clip"] = old[x["n"]]
            merge("scripts", item_id, dict(out, status="draft", approvedBy="", approvedAt=0, updatedAt=now(), updatedBy="claude",
                                           gen=dict(g, state="done", secs=int(time.time() - t0), doneAt=now(), error="")))
            log(f"script: wrote {it.get('code', '')} {it.get('title', '')} ({len(out['shots'])} shots) in {int(time.time() - t0)} s")
        except Exception as e:
            merge("scripts", item_id, {"gen": dict(g, state="failed", error=str(e)[:300], doneAt=now())})
            log("script ERROR " + traceback.format_exc().strip().replace("\n", " | ")[-600:])


# ---------- the script → an animated film made of the gzscenes.js templates ----------
TEMPLATES = """hook      Opening hook. data {kicker?: series/label, title: the hook with one *highlight*, sub?: one short line, icon}
iconText  One point explained. data {tag?: short label, icon, title, text: 1-2 short sentences}
lens      Magnifier on small print (tyre sidewall, labels). data {heading?, band: the printed text e.g. "MICHELIN 80/90-14 M/C 46P TUBELESS", word: one word from band to zoom on, label: what it means with *highlight*, text?}
compare   Two things side by side. data {heading?, left:{icon,title,text,mark}, right:{icon,title,text,mark}}  mark = "yes" | "no" | "" (right/wrong)
steps     How-to, 2-5 steps. data {heading, steps:[{icon?, text}]}
stop      Don'ts / danger signs, 2-6 items. data {heading, items:[text]}
endcard   Last scene: product + Gearizo logo + tagline. data {title: tagline with *highlight*, sub?: product name, cta?: e.g. "SAVE & SHARE", icon: fallback drawing if no product photo}"""
ICON_LIST = "tyre tube nail inflator rimSpoke rimSport car motorbike wiper gauge thermo sticker warning clock check cross box leak patch shop push sparkle phone battery bolt"
TPL_IDS = {"hook", "iconText", "lens", "compare", "steps", "stop", "endcard"}
FILM_SYSTEM = """You turn a short-video script into an animated explainer made ONLY of these templates (vertical 1080x1920):
""" + TEMPLATES + """
Icons available (use exactly these names): """ + ICON_LIST + """
Return ONE JSON object, nothing else:
{"theme": "paper" | "pink", "scenes": [{"tpl": "...", "dur": seconds, "trans": "slide" | "zoom" | "wipe", "data": {...}}]}
Rules:
- Follow the script's order and timing; one scene per idea, 3-8 s each; durations add up to the script length (±10%).
- Start with hook, end with endcard. Use steps/stop/compare/lens where they fit; iconText for everything else.
- On-screen text is SHORT (titles <= 6 words, lines <= 10 words) in the script's language. Mark one key word per title with *stars*.
- Vary transitions; "slide" is the default. The first scene's trans is ignored.
- theme "paper" (workshop paper, green/orange) unless the team asks for pink/brand colours."""


def build_film_prompt(it, sc, req):
    keep = {k: sc.get(k) for k in ("title", "length", "lang", "style", "cover", "summary", "lines", "shots")}
    for x in keep.get("shots") or []:
        x.pop("clip", None); x.pop("first", None); x.pop("motion", None)
    p = ["VIDEO: " + (it.get("code") or "") + " " + (it.get("title") or ""), "SCRIPT:\n" + json.dumps(keep, ensure_ascii=False)[:12000]]
    if it.get("product"):
        p.append("Product: " + it["product"])
    if (req.get("steer") or "").strip():
        p.append("THE TEAM ASKS: " + req["steer"].strip()[:1500])
    p.append("Return only the JSON object.")
    return "\n\n".join(p)


def clean_film(d):
    icons = set(ICON_LIST.split())
    s = lambda v, n=300: str(v if v is not None else "")[:n]
    ic = lambda v: v if v in icons else "sparkle"
    out = []
    for x in (d.get("scenes") or [])[:20]:
        tpl = x.get("tpl") if x.get("tpl") in TPL_IDS else "iconText"
        g = x.get("data") or {}
        if tpl == "hook":
            data = {"kicker": s(g.get("kicker"), 40), "title": s(g.get("title"), 120), "sub": s(g.get("sub"), 160), "icon": ic(g.get("icon"))}
        elif tpl == "iconText":
            data = {"tag": s(g.get("tag"), 40), "icon": ic(g.get("icon")), "title": s(g.get("title"), 120), "text": s(g.get("text"), 220)}
        elif tpl == "lens":
            data = {"heading": s(g.get("heading"), 80), "band": s(g.get("band"), 80), "word": s(g.get("word"), 30), "label": s(g.get("label"), 80), "text": s(g.get("text"), 160)}
        elif tpl == "compare":
            side = lambda v: {"icon": ic((v or {}).get("icon")), "title": s((v or {}).get("title"), 40), "text": s((v or {}).get("text"), 90),
                              "mark": (v or {}).get("mark") if (v or {}).get("mark") in ("yes", "no") else ""}
            data = {"heading": s(g.get("heading"), 80), "left": side(g.get("left")), "right": side(g.get("right"))}
        elif tpl == "steps":
            data = {"heading": s(g.get("heading"), 80), "steps": [{"icon": ic(y.get("icon")) if y.get("icon") else "", "text": s(y.get("text"), 90)}
                                                                 for y in (g.get("steps") or [])[:5] if isinstance(y, dict)]}
        elif tpl == "stop":
            data = {"heading": s(g.get("heading"), 80), "items": [s(y, 70) for y in (g.get("items") or [])[:6]]}
        else:
            data = {"title": s(g.get("title"), 120), "sub": s(g.get("sub"), 80), "cta": s(g.get("cta"), 30), "icon": ic(g.get("icon") or "box"), "image": ""}
        try:
            dur = max(1.5, min(15, float(x.get("dur") or 4)))
        except (TypeError, ValueError):
            dur = 4
        out.append({"id": f"s{len(out) + 1}", "tpl": tpl, "dur": round(dur, 2), "trans": x.get("trans") if x.get("trans") in ("slide", "zoom", "wipe") else "slide", "data": data})
    return {"theme": d.get("theme") if d.get("theme") in ("paper", "pink") else "paper", "scenes": out}


def handle_films(docs, merge, put, log):
    rows = docs("scripts")
    todo = [(k, v) for k, v in rows.items() if (v.get("filmGen") or {}).get("state") == "queued"]
    if not todo:
        return
    items, edits = docs("items"), docs("edits")
    now = lambda: int(time.time() * 1000)
    for item_id, sc in todo[:1]:
        g = sc.get("filmGen") or {}
        it = items.get(item_id)
        if not it or not (sc.get("lines") or sc.get("shots")):
            merge("scripts", item_id, {"filmGen": dict(g, state="failed", error="Write the script first.", doneAt=now())})
            continue
        merge("scripts", item_id, {"filmGen": dict(g, state="writing", startedAt=now())})
        t0 = time.time()
        try:
            film = clean_film(ask_claude(build_film_prompt(it, sc, g), FILM_SYSTEM))
            if not film["scenes"]:
                raise RuntimeError("Claude returned no scenes")
            old = edits.get(item_id) or {}
            if old.get("film"):                       # keep pictures the team already put in
                imgs = [x.get("data", {}).get("image") for x in old["film"].get("scenes", []) if x.get("tpl") == "endcard" and x.get("data", {}).get("image")]
                for x in film["scenes"]:
                    if x["tpl"] == "endcard" and imgs:
                        x["data"]["image"] = imgs[0]
            dur = round(sum(x["dur"] for x in film["scenes"]), 2)
            doc = dict(old if old.get("film") else {}, item=item_id, film=film, w=1080, h=1920, fps=30, dur=dur,
                       layers=old.get("layers", []) if old.get("film") else [], audio=old.get("audio", {}) if old.get("film") else {},
                       rev=int(old.get("rev") or 0) + 1, updatedAt=now(), updatedBy="claude", render=old.get("render") or {"state": "idle"},
                       board={})                  # a new storyboard waits for the team's OK again
            if old and not old.get("film"):
                raise RuntimeError("This video already has a filmed project (Adjust). Make the animation on another video, or ask to replace it.")
            put("edits", item_id, doc)
            merge("scripts", item_id, {"filmGen": dict(g, state="done", scenes=len(film["scenes"]), secs=int(time.time() - t0), doneAt=now(), error="")})
            log(f"film: {it.get('code', '')} {it.get('title', '')} -> {len(film['scenes'])} scenes in {int(time.time() - t0)} s")
        except Exception as e:
            merge("scripts", item_id, {"filmGen": dict(g, state="failed", error=str(e)[:300], doneAt=now())})
            log("film ERROR " + traceback.format_exc().strip().replace("\n", " | ")[-600:])


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 2 and a[0] == "test":
        import nas_sync as NS
        items = NS.docs("items")
        it = next((v for v in items.values() if (v.get("code") or "").upper() == a[1].upper()), None)
        if not it:
            sys.exit("no such code")
        series = NS.docs("settings").get("series:" + (it.get("series") or ""), {})
        print(json.dumps(clean(ask_claude(build_prompt(it, series, {}, None))), ensure_ascii=False, indent=1))
    else:
        print(__doc__)

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


def ask_claude(prompt):
    cmd = [claude_path(), "-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--strict-mcp-config",
           "--setting-sources", "", "--system-prompt", SYSTEM]
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

#!/usr/bin/env python3
"""Gearizo editable videos: projects made by Claude (口播 subtitles, 花字, stickers, images over a clean base video)
that the content team adjusts in the app's Adjust screen. This Mac renders the adjusted version.

A project is a folder with project.json + the files it uses:
  project.json  {"w":1080,"h":1920,"fps":30,"dur":62.4,"base":{"path":"base.mp4"},"layers":[...]}
                layers as in gzlayers.js; image/sticker layers have "src":{"path":"assets/x.png"}
  base.mp4      the video WITHOUT subtitles/花字 (they're drawn on top)
See PROJECT.md for the full format.

  python3 gz_edit.py push <folder> <GZ code> [--force]   send a project to the app (copies it to the NAS)
  python3 gz_edit.py render <folder> <out.mp4>            render a project folder here, without the app
The NAS job calls handle_renders() every run: projects someone pressed "Render" on become a new version.
"""
import json, os, re, shutil, subprocess, sys, tempfile, time, traceback, urllib.parse
from glob import glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settings as S  # noqa: E402

FFMPEG = S.FFMPEG
PROJECTS = os.path.join(S.NAS_ROOT, "Content Video", "Projects")
GZL = next((p for p in (os.path.join(HERE, "gzlayers.js"), os.path.join(HERE, "..", "gzlayers.js")) if os.path.isfile(p)), os.path.join(HERE, "gzlayers.js"))  # the app's copy, so both draw alike
RENDER_JS = os.path.join(HERE, "gz_render.mjs")
PREVIEW_MAX_BYTES = 19_000_000
CUTOUT = os.path.join(HERE, "cutout")
MUSIC_DIR = os.path.join(S.NAS_ROOT, "Content Video", "Music")
SFX_DIR = os.path.join(S.NAS_ROOT, "Content Video", "SFX")
GZS_JS = os.path.join(os.path.dirname(GZL), "gzscenes.js")
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".aac")
EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
       "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/aac": ".aac", "video/mp4": ".mp4"}


def _storage(method, oid, data=None, ctype=None):
    import urllib.request
    h = {"apikey": S.KEY}
    if ctype:
        h["Content-Type"] = ctype
    req = urllib.request.Request(S.URL + "/storage/v1/object/media/" + oid, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read(), (r.headers.get("Content-Type") or "").split(";")[0]


def fetch_blob(ref, dest_dir):
    """A file the app uploaded ("/_blob/<id>") -> a local file in dest_dir."""
    oid = str(ref).rsplit("/", 1)[-1]
    data, ct = _storage("GET", oid)
    os.makedirs(dest_dir, exist_ok=True)
    p = os.path.join(dest_dir, oid + EXT.get(ct, ""))
    with open(p, "wb") as f:
        f.write(data)
    return p


def put_blob(path, ctype):
    import uuid
    oid = uuid.uuid4().hex
    with open(path, "rb") as f:
        _storage("POST", oid, f.read(), ctype)
    return "/_blob/" + oid


def localize(doc, proj):
    """Copy of an app-made film with every uploaded picture / voice-over downloaded into proj."""
    d = json.loads(json.dumps(doc))
    for x in (d.get("film") or {}).get("scenes", []):
        g = x.get("data") or {}
        for k in ("image", "logo"):
            if str(g.get(k, "")).startswith("/_blob/"):
                g[k] = os.path.relpath(fetch_blob(g[k], os.path.join(proj, "assets")), proj)
    a = d.get("audio") or {}
    for k in ("vo", "bgm"):
        x = a.get(k) or {}
        if str(x.get("url", "")).startswith("/_blob/") and not x.get("path"):
            x["path"] = os.path.relpath(fetch_blob(x["url"], os.path.join(proj, "audio")), proj)
    return d


def handle_cutouts(docs, merge, log):
    """Product photos uploaded with "remove background": Vision cuts them out, the cut-out replaces the photo."""
    for item_id, d in docs("edits").items():
        film = d.get("film") or {}
        changed = False
        for x in film.get("scenes", []):
            g = x.get("data") or {}
            if g.get("imageCut") != "pending" or not str(g.get("image", "")).startswith("/_blob/"):
                continue
            tmp = tempfile.mkdtemp(prefix="gz-cut-")
            try:
                src = fetch_blob(g["image"], tmp)
                out = os.path.join(tmp, "cut.png")
                if not os.path.isfile(CUTOUT):
                    raise RuntimeError("the cut-out tool isn't built on this Mac")
                run([CUTOUT, src, out], timeout=180)
                g["image"], g["imageCut"] = put_blob(out, "image/png"), "done"
                log(f"cut out the product photo for {item_id}")
            except Exception as e:
                g["imageCut"], g["imageCutError"] = "failed", str(e)[:200]
                log("cutout ERROR " + str(e)[:300])
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
            changed = True
        if changed:
            merge("edits", item_id, {"film": film, "updatedAt": int(time.time() * 1000), "updatedBy": "mac"})


def _listing(folder):
    os.makedirs(folder, exist_ok=True)
    out = []
    for f in sorted(os.listdir(folder)):
        if f.lower().endswith(AUDIO_EXT) and not f.startswith("."):
            st = os.stat(os.path.join(folder, f))
            out.append((f, st.st_size))
    return out


def _publish_audio(folder, rel, key, docs, put, preview, limit):
    """List the songs / sound effects in a NAS folder -> settings/<key>, each with a copy the app can play."""
    files = _listing(folder)[:limit]
    cur = docs("settings").get(key) or {}
    old = {(x.get("name"), x.get("size")): x for x in cur.get("files", [])}
    if [(x.get("name"), x.get("size")) for x in cur.get("files", [])] == files and all(x.get("url") for x in cur.get("files", [])):
        return
    out = []
    for f, size in files:
        p = os.path.join(folder, f)
        x = old.get((f, size))
        if not (x and x.get("url")):
            tmp = tempfile.mkdtemp(prefix="gz-aud-")
            try:
                dur = round(probe_audio(p), 2)
                q = os.path.join(tmp, "a.m4a")
                run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", p, "-vn"] + (["-t", "240"] if preview else []) +
                    ["-ac", "2", "-ar", "44100", "-c:a", "aac", "-b:a", "96k" if preview else "160k", q], timeout=300)
                x = {"name": f, "size": size, "path": "nas:" + rel + "/" + f, "dur": dur, "url": put_blob(q, "audio/mp4")}
            except Exception:
                x = {"name": f, "size": size, "path": "nas:" + rel + "/" + f, "dur": 0}
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        out.append(x)
    for k, x in old.items():                     # files taken off the NAS: drop their app copies
        if x.get("url") and not any(o.get("url") == x["url"] for o in out):
            try:
                _storage("DELETE", x["url"].rsplit("/", 1)[-1])
            except Exception:
                pass
    put("settings", key, {"files": out, "at": int(time.time() * 1000)})


def list_music(docs, put):
    """Background music in Content Video/Music and sound effects in Content Video/SFX -> settings/music, settings/sfx."""
    _publish_audio(MUSIC_DIR, "Content Video/Music", "music", docs, put, True, 200)
    _publish_audio(SFX_DIR, "Content Video/SFX", "sfx", docs, put, False, 300)


def probe_audio(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0


def node_path():
    c = S.CFG.get("node") or shutil.which("node")
    if c:
        return c
    found = sorted(glob(os.path.expanduser("~/.nvm/versions/node/*/bin/node")) + glob("/opt/homebrew/bin/node") + glob("/usr/local/bin/node"))
    if not found:
        raise RuntimeError("Node.js not found on this computer")
    return found[-1]


def run(cmd, timeout=3600):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout or "failed").strip()[-600:])
    return r.stdout


def probe(path):
    """width, height, fps, duration of a video, read from ffmpeg's banner."""
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    t = r.stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", t)
    v = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", t)
    f = re.search(r"([\d.]+) fps", t)
    if not (m and v):
        raise RuntimeError("could not read " + os.path.basename(path))
    return {"w": int(v.group(1)), "h": int(v.group(2)), "fps": round(float(f.group(1)), 3) if f else 30,
            "dur": int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))}


def file_url(p):
    return "file://" + urllib.parse.quote(os.path.abspath(p))


TPL_DUR = {"hook": 3.2, "iconText": 4, "lens": 5, "compare": 5, "steps": 6, "stop": 6, "endcard": 5}   # as in gzscenes.js


def film_dur(film):
    return round(sum(max(0.6, float(s.get("dur") or TPL_DUR.get(s.get("tpl"), 3))) for s in film.get("scenes") or []), 3)


def audio_args(doc, proj_dir, dur, first_input, sfx_files=None):
    """ffmpeg inputs + filter for the music, voice-over and sound effects (doc.audio), or a silent track.
    The music dips under the voice (audio.bgm.duck, on by default)."""
    a = doc.get("audio") or {}
    ins, parts, mix, k = [], [], [], first_input
    bgm, vo = a.get("bgm") or {}, a.get("vo") or {}

    def where(x):
        xp = str(x.get("path") or "")
        p = os.path.join(S.NAS_ROOT, xp[4:]) if xp.startswith("nas:") else os.path.join(proj_dir, xp) if xp else ""
        if p and not os.path.isfile(p):
            here = os.path.join(HERE, xp)
            p = here if xp and os.path.isfile(here) else ""
        return p
    vo_p, bgm_p = where(vo), where(bgm)
    duck = bool(vo_p and bgm_p and bgm.get("duck", True))
    if vo_p:
        ins += ["-i", vo_p]
        at = int(float(vo.get("at", 0)) * 1000)
        chain = f"[{k}:a]aformat=channel_layouts=stereo,volume={float(vo.get('vol', 1))},adelay={at}|{at},apad,atrim=0:{dur:.3f}"
        if duck:
            parts += [chain + "[vo]", "[vo]asplit[vom][vosc]"]
        else:
            parts.append(chain + "[vom]")
        mix.append("[vom]")
        k += 1
    if bgm_p:
        ins += ["-stream_loop", "-1", "-i", bgm_p]
        vol = float(bgm.get("vol", 0.35 if vo_p else 0.8))
        chain = f"[{k}:a]aformat=channel_layouts=stereo,atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,volume={vol},afade=t=in:d=0.6,afade=t=out:st={max(0, dur - 1.5):.3f}:d=1.5"
        if duck:
            parts.append(chain + "[bg0]")
            parts.append("[bg0][vosc]sidechaincompress=threshold=0.015:ratio=8:attack=30:release=450:makeup=1[bgm]")
        else:
            parts.append(chain + "[bgm]")
        mix.append("[bgm]")
        k += 1
    fx = a.get("sfx") or {}
    if doc.get("film") and sfx_files and fx.get("on", True) is not False:
        fvol = float(fx.get("vol", 0.6))
        n = 0
        for c in sound_plan(doc, sfx_files):
            f = c.get("file") or {}
            p = os.path.join(SFX_DIR, f.get("name", "")) if f.get("name") else ""
            if not p or not os.path.isfile(p) or not (0 <= float(c["t"]) < dur):
                continue
            ms = int(float(c["t"]) * 1000)
            ins += ["-i", p]
            parts.append(f"[{k}:a]aformat=channel_layouts=stereo,volume={fvol},adelay={ms}|{ms},apad,atrim=0:{dur:.3f}[fx{n}]")
            mix.append(f"[fx{n}]")
            k += 1
            n += 1
    if not mix:
        return ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"], [], f"{k}:a"
    parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=longest,atrim=0:{dur:.3f},alimiter=limit=0.95[aout]")
    return ins, parts, "[aout]"


# ---------- voice-over: fit the scenes to it ----------
def _levels(path, step=0.02):
    """Loudness of the voice every 20 ms, in dB."""
    import struct, math
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True, timeout=300).stdout
    n, F = len(raw) // 2, int(8000 * step)
    x = struct.unpack("<%dh" % n, raw[:n * 2])
    return [10 * math.log10(sum(v * v for v in x[i:i + F]) / F / 32768 ** 2 + 1e-12) for i in range(0, n - F + 1, F)]


def speech_segments(path, min_pause=0.06):
    """Where someone is talking: [[start, end], ...] in seconds, split at every pause of min_pause or more.
    "Quiet" is judged against this recording's own loudness, so studio, phone and AI voices all work."""
    db, step = _levels(path), 0.02
    if not db:
        return [], 0.0
    srt = sorted(db)
    loud = srt[int(len(srt) * 0.9)]
    thr = min(loud - 26, max(srt[int(len(srt) * 0.05)] + 6, loud - 36))
    total = len(db) * step
    segs, st, quiet = [], None, 0
    for i, v in enumerate(db + [-200.0] * int(min_pause / step + 2)):
        if v >= thr:
            if st is None:
                st = i
            quiet = 0
        elif st is not None:
            quiet += 1
            if quiet * step >= min_pause:
                end = i - quiet + 1
                if (end - st) * step >= 0.08:
                    segs.append([round(st * step, 3), round(min(total, end * step), 3)])
                st, quiet = None, 0
    return segs, round(total, 3)


def merge_short(segs, gap=0.25):
    """Join talking parts separated by short pauses (for the timeline and for dipping the music)."""
    out = []
    for s, e in segs:
        if out and s - out[-1][1] < gap:
            out[-1][1] = e
        else:
            out.append([s, e])
    return out


def align_lines(segs, texts):
    """Split the talking parts into one span per script line (by pauses, guided by each line's length)."""
    n = len(texts)
    if not segs or not n:
        return []
    if n == 1:
        return [[segs[0][0], segs[-1][1]]]
    w = [max(1, len(re.sub(r"\s+", "", str(x or "")))) for x in texts]
    talk = sum(e - s for s, e in segs)
    exp, c = [], 0
    for k in range(n - 1):
        c += w[k]
        exp.append(c / sum(w) * talk)
    G = len(segs) - 1
    pos, acc = [], 0.0
    for j in range(G):
        acc += segs[j][1] - segs[j][0]
        pos.append(acc)

    def real(p):                                  # talking-time -> clock time
        a = 0.0
        for s, e in segs:
            if p <= a + (e - s):
                return s + (p - a)
            a += e - s
        return segs[-1][1]
    if G < n - 1:                                 # not enough pauses: cut by length
        b = [segs[0][0]] + [real(x) for x in exp] + [segs[-1][1]]
        return [[round(b[k], 3), round(b[k + 1], 3)] for k in range(n)]
    gap = [segs[j + 1][0] - segs[j][1] for j in range(G)]
    cost = lambda k, j: abs(pos[j] - exp[k]) - 0.8 * min(gap[j], 1.0)
    INF = float("inf")
    best = [[INF] * G for _ in range(n - 1)]
    back = [[-1] * G for _ in range(n - 1)]
    for j in range(G):
        best[0][j] = cost(0, j)
    for k in range(1, n - 1):
        run_min, run_arg = INF, -1
        for j in range(G):
            if j - 1 >= 0 and best[k - 1][j - 1] < run_min:
                run_min, run_arg = best[k - 1][j - 1], j - 1
            if run_arg >= 0:
                best[k][j] = run_min + cost(k, j)
                back[k][j] = run_arg
    j = min(range(G), key=lambda x: best[n - 2][x])
    cuts = [j]
    for k in range(n - 2, 0, -1):
        j = back[k][j]
        cuts.append(j)
    cuts.reverse()
    out, a = [], 0
    for c in cuts + [G]:
        out.append([segs[a][0], segs[c][1]])
        a = c + 1
    return out


def _line_range(s):
    m = re.search(r"(\d+(?:\.\d+)?)\s*[–\-~to]+\s*(\d+(?:\.\d+)?)", str(s or ""))
    return (float(m.group(1)), float(m.group(2))) if m else None


def scene_lines(film, lines):
    """Which script lines each scene speaks: Claude's "lines" when given, else by the script's timings."""
    sc = film.get("scenes") or []
    n = len(lines)
    if any(isinstance(x.get("lines"), list) and x["lines"] for x in sc):
        return [[i for i in (x.get("lines") or []) if isinstance(i, int) and 0 <= i < n] for x in sc]
    dur = [max(0.6, float(x.get("dur") or TPL_DUR.get(x.get("tpl"), 3))) for x in sc]
    tot = sum(dur) or 1
    rng = [_line_range(l.get("t")) for l in lines]
    if all(rng):
        end = max(r[1] for r in rng) or 1
        mids = [(r[0] + r[1]) / 2 / end * tot for r in rng]
    else:
        mids = [(k + 0.5) / n * tot for k in range(n)]
    out, a = [[] for _ in sc], 0
    st = []
    for d in dur:
        st.append(a)
        a += d
    for k, m in enumerate(mids):
        j = max([i for i, s in enumerate(st) if s <= m] or [0])
        out[j].append(k)
    return out


def fit_to_vo(film, spans, groups, tr=0.5, segs=None):
    """New scene lengths so each scene sits on its lines; steps/stop items appear with their lines.
    Returns (film, vo_at): vo_at delays the voice when scenes without lines come first."""
    sc = film["scenes"]
    lead = 0.0
    k0 = next((i for i, g in enumerate(groups) if g), None)
    if k0 is None:
        return film, 0.0
    for i in range(k0):
        lead += max(1.2, float(sc[i].get("dur") or 3))
    at = lead
    # start of each scene with lines = when its first line starts (minus a breath), on the film's clock
    lined = [i for i, g in enumerate(groups) if g]
    first = {i: spans[min(groups[i])][0] + at for i in lined}
    last = {i: spans[max(groups[i])][1] + at for i in lined}
    start = {}
    for n_, i in enumerate(lined):
        if n_ == 0:
            start[i] = lead
        else:
            p = lined[n_ - 1]
            start[i] = max(last[p] + 0.05, first[i] - 0.15)
    end_talk = last[lined[-1]]
    for n_, i in enumerate(lined):
        nxt = lined[n_ + 1] if n_ + 1 < len(lined) else None
        stop = start[nxt] if nxt is not None else max(end_talk + 0.8, start[i] + 1.5)
        between = list(range(i + 1, nxt if nxt is not None else len(sc)))
        if nxt is None:                      # scenes after the last line keep their own length
            sc[i]["dur"] = round(max(1.2, stop - start[i]), 2)
            for j in between:
                sc[j]["dur"] = round(max(1.2, float(sc[j].get("dur") or 3)), 2)
            continue
        want = [max(1.0, float(sc[j].get("dur") or 3)) for j in between]
        room = stop - max(last[i] + 0.2, start[i] + 1.2)
        if between and sum(want) > room:
            k = max(room, 1.0 * len(between)) / sum(want)
            want = [x * k for x in want]
        mine = max(1.2, stop - start[i] - sum(want))
        sc[i]["dur"] = round(mine, 2)
        for j, x in zip(between, want):
            sc[j]["dur"] = round(x, 2)
    # steps / stop items come in with their own lines
    s0 = 0.0
    for i, x in enumerate(sc):
        g, d = groups[i], x.get("data") or {}
        key = "steps" if x.get("tpl") == "steps" else "items" if x.get("tpl") == "stop" else None
        if key and g and d.get(key):
            m = len(d[key][:5 if key == "steps" else 6])
            base = s0 - tr if i > 0 else s0
            if len(g) >= m:
                at_ = [spans[k][0] for k in g[-m:]]
            else:                            # fewer lines than items: use the pauses inside those lines
                a0, b0 = spans[min(g)][0], spans[max(g)][1]
                inside = [s for s, e in (segs or []) if a0 - 0.01 <= s < b0]
                at_ = [inside[round(j * (len(inside) - 1) / max(1, m - 1))] for j in range(m)] if len(inside) >= m else None
                if at_ and len(set(at_)) < m:
                    at_ = None
            if at_:
                d["times"] = [round(max(0.3, x + at - base), 2) for x in at_]
            else:
                d.pop("times", None)
        s0 += float(x["dur"])
    return film, round(at, 3)


def handle_vo(docs, merge, log):
    """Voice-overs uploaded in the app: clean up the sound, find the pauses and fit the scenes to the lines."""
    eds = None
    for item_id, d in docs("edits").items():
        vo = (d.get("audio") or {}).get("vo") or {}
        if vo.get("align") != "pending" or not d.get("film") or not str(vo.get("url", "")).startswith("/_blob/"):
            continue
        now = lambda: int(time.time() * 1000)
        tmp = tempfile.mkdtemp(prefix="gz-vo-")
        try:
            src = fetch_blob(vo["url"], tmp)
            url = vo["url"]
            if not vo.get("clean"):              # louder, even voice; one small file the app and renders both use
                q = os.path.join(tmp, "vo.m4a")
                run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11",
                     "-ac", "1", "-ar", "48000", "-c:a", "aac", "-b:a", "160k", q], timeout=300)
                url = put_blob(q, "audio/mp4")
                try:
                    _storage("DELETE", vo["url"].rsplit("/", 1)[-1])
                except Exception:
                    pass
                src = q
            segs, total = speech_segments(src)
            if not segs:
                raise RuntimeError("couldn't hear any talking in the voice-over")
            sc = (docs("scripts").get(item_id) or {})
            lines = sc.get("lines") or []
            if not any(str(l.get("line") or "").strip() for l in lines):
                lines = []
            film = json.loads(json.dumps(d["film"]))
            if lines:
                spans = align_lines(segs, [l.get("line") for l in lines])
                groups = scene_lines(film, lines)
            else:                                 # no script: spread the talking over the scenes by their lengths
                spans = [[s, e] for s, e in segs]
                groups = [[] for _ in film["scenes"]]
                dur = [float(x.get("dur") or 3) for x in film["scenes"]]
                tot = sum(dur) or 1
                for k, (s, e) in enumerate(spans):
                    m = (s + e) / 2 / total * tot
                    j, acc = 0, 0
                    for i, x in enumerate(dur):
                        if m >= acc:
                            j = i
                        acc += x
                    groups[j].append(k)
            film, at = fit_to_vo(film, spans, groups, segs=segs)
            fdur = round(sum(float(x["dur"]) for x in film["scenes"]), 3)
            nvo = dict(vo, url=url, clean=True, align="done", at=at, dur=round(total, 2), segs=merge_short(segs), lines=spans, error="", doneAt=now())
            audio = dict(d.get("audio") or {}, vo=nvo)
            merge("edits", item_id, {"film": film, "audio": audio, "dur": fdur, "rev": int(d.get("rev") or 0) + 1, "updatedAt": now(), "updatedBy": "mac"})
            log(f"vo: fitted {len(film['scenes'])} scenes of {item_id} to {len(spans)} lines ({total:.1f} s of voice)")
        except Exception as e:
            audio = dict(d.get("audio") or {}, vo=dict(vo, align="failed", error=str(e)[:200]))
            merge("edits", item_id, {"audio": audio})
            log("vo ERROR " + traceback.format_exc().strip().replace("\n", " | ")[-500:])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def sound_plan(doc, files):
    """The film's sound effects [{t, file:{name,...}}], worked out by gzscenes.js exactly as the app shows them."""
    js = ("const fs=require('fs');require(process.argv[1]);const d=JSON.parse(fs.readFileSync(0,'utf8'));"
          "process.stdout.write(JSON.stringify(GZS.soundPlan(d.film,d.audio,d.files)))")
    r = subprocess.run([node_path(), "-e", js, GZS_JS], input=json.dumps({"film": doc.get("film"), "audio": doc.get("audio") or {}, "files": files}),
                       capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise RuntimeError("sound plan: " + (r.stderr or "")[-200:])
    return json.loads(r.stdout or "[]")


def render_project(doc, proj_dir, out_mp4, log=print):
    """Draw the layers over the base video (or the animated scenes of doc.film) into out_mp4."""
    film = doc.get("film")
    if film:
        dur = float(doc.get("dur") or 0) or film_dur(film)
        info = {"w": 1080, "h": 1920, "fps": 30, "dur": dur}
        base = None
    else:
        base = os.path.join(proj_dir, doc["base"]["path"])
        if not os.path.isfile(base):
            raise RuntimeError("base video missing: " + doc["base"]["path"])
        info = probe(base)
    job = dict(doc, w=doc.get("w") or info["w"], h=doc.get("h") or info["h"], fps=doc.get("fps") or info["fps"], dur=info["dur"],
               projUrl=file_url(proj_dir) + "/")
    layers = []
    for L in doc.get("layers", []):
        L = dict(L)
        if L.get("kind") in ("image", "sticker"):
            p = os.path.join(proj_dir, (L.get("src") or {}).get("path", ""))
            if not os.path.isfile(p):
                raise RuntimeError("file missing for layer " + str(L.get("name") or L.get("id")) + ": " + str((L.get("src") or {}).get("path")))
            L["src"] = dict(L.get("src") or {}, file=file_url(p), abs=p)
        layers.append(L)
    job["layers"] = layers
    tmp = tempfile.mkdtemp(prefix="gz-render-")
    try:
        frames = os.path.join(tmp, "frames")
        os.makedirs(frames)
        with open(os.path.join(tmp, "job.json"), "w") as f:
            json.dump(job, f, ensure_ascii=False)
        out = run([node_path(), RENDER_JS, os.path.join(tmp, "job.json"), frames, GZL] + ([S.CFG["chrome"]] if S.CFG.get("chrome") else []), timeout=1800)
        log("render: captured " + out.strip())
        # ffmpeg: base (the video, or the captured animation), then each sticker clip, then the text/image frames on top
        fps = job["fps"]
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"] + (["-framerate", str(fps), "-i", os.path.join(frames, "f%05d.jpg")] if film else ["-i", base])
        stickers = [L for L in layers if L.get("kind") == "sticker"]
        for L in stickers:
            cmd += (["-stream_loop", str(int(L["loop"]))] if L.get("loop") else []) + ["-i", L["src"]["abs"]]
        if not film:
            cmd += ["-f", "concat", "-safe", "0", "-i", os.path.join(frames, "layers.ffconcat")]
        parts, cur = [], "[0:v]"
        for i, L in enumerate(stickers, start=1):
            st, en = float(L.get("start", 0)), float(L.get("end", 0))
            w = max(2, int(round(float(L.get("w") or 300) * float(L.get("s") or 1) / 2)) * 2)
            c = L.get("crop")
            chain = f"[{i}:v]format=rgba" + (f",crop={int(c[2])}:{int(c[3])}:{int(c[0])}:{int(c[1])}" if c and len(c) == 4 else "") + f",scale={w}:-2"
            rot = float(L.get("rot") or 0)
            if rot:
                r = rot * 3.141592653589793 / 180
                chain += f",rotate={r:.5f}:c=none:ow=rotw({r:.5f}):oh=roth({r:.5f})"
            an = L.get("anim") or {}
            if an.get("in") in ("fade", "pop", "up"):
                chain += ",fade=t=in:st=0:d=0.25:alpha=1"
            if an.get("out") == "fade":
                chain += f",fade=t=out:st={max(0, en - st - 0.25):.3f}:d=0.25:alpha=1"
            chain += f",setpts=PTS-STARTPTS+{st:.3f}/TB[s{i}]"
            parts.append(chain)
            parts.append(f"{cur}[s{i}]overlay=x={float(L.get('x', 0)):.1f}-w/2:y={float(L.get('y', 0)):.1f}-h/2:"
                         f"enable='between(t,{st:.3f},{en:.3f})':eof_action=pass[b{i}]")
            cur = f"[b{i}]"
        n = len(stickers) + 1
        if film:
            parts.append(f"{cur}scale=in_range=pc:out_range=tv,format=yuv420p[v]")
            ains, aparts, amap = audio_args(doc, proj_dir, info["dur"], n, doc.get("_sfx_files"))
            cmd += ains
            parts += aparts
            cmd += ["-filter_complex", ";".join(parts), "-map", "[v]", "-map", amap, "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                    "-r", str(fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{info['dur']:.3f}", "-movflags", "+faststart", out_mp4]
        else:
            parts.append(f"[{n}:v]format=rgba,setpts=PTS-STARTPTS[top]")
            parts.append(f"{cur}[top]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]")
            cmd += ["-filter_complex", ";".join(parts), "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "18",
                    "-preset", "medium", "-c:a", "copy", "-movflags", "+faststart", out_mp4]
        run(cmd, timeout=3600)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out_mp4


# ---------- the app side: render what someone asked for ----------
def safe_name(s):
    return re.sub(r"\s+", " ", re.sub(r"[\\/:*?\"<>|]+", " ", s)).strip()[:60].strip()


def handle_renders(api, docs, merge, log, items, versions, add_file):
    """Each edit with render.state == "queued": render it, drop it in Checking and add it as the next version."""
    import nas_preview as NP
    for item_id, d in docs("edits").items():
        r = d.get("render") or {}
        if r.get("state") != "queued":
            continue
        it = items.get(item_id)
        if not it:
            merge("edits", item_id, {"render": dict(r, state="failed", error="The video isn't in the app any more.", doneAt=int(time.time() * 1000))})
            continue
        merge("edits", item_id, {"render": dict(r, state="rendering", startedAt=int(time.time() * 1000))})
        t0 = time.time()
        work = None
        try:
            if d.get("film") and not d.get("dir"):          # made in the app: everything it needs comes from storage
                work = proj = tempfile.mkdtemp(prefix="gz-film-")
                d = localize(d, proj)
                d["_sfx_files"] = (docs("settings").get("sfx") or {}).get("files") or []
            else:
                proj = os.path.join(S.NAS_ROOT, d["dir"])
            if not os.path.isdir(proj):
                raise RuntimeError("project folder not found on the NAS: " + d["dir"])
            n = max([v.get("n", 0) for v in versions.values() if v.get("item") == item_id] or [0]) + 1
            name = safe_name(((it.get("code") or "") + " " + (it.get("title") or "video")).strip()) + f" v{n}.mp4"
            tmp_out = os.path.join(tempfile.gettempdir(), f"gz-out-{item_id}-{int(t0)}.mp4")
            render_project(d, proj, tmp_out, log)
            dest = os.path.join(NP.CHECKING, name)
            part = os.path.join(NP.CHECKING, "." + name + ".part")
            shutil.copyfile(tmp_out, part)
            os.rename(part, dest)
            os.remove(tmp_out)
            st = os.stat(dest)
            by = r.get("by") or ""
            add_file({"path": dest, "name": name, "size": st.st_size, "mtime": int(st.st_mtime), "item": item_id},
                     items, versions, note="Adjusted in Gearizo", by=by)
            merge("edits", item_id, {"render": dict(r, state="done", n=n, file=name, secs=int(time.time() - t0), doneAt=int(time.time() * 1000))})
            log(f"rendered {name} from the adjusted project in {int(time.time() - t0)} s")
        except Exception as e:
            merge("edits", item_id, {"render": dict(r, state="failed", error=str(e)[:300], doneAt=int(time.time() * 1000))})
            log("render ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        finally:
            if work:
                shutil.rmtree(work, ignore_errors=True)


# ---------- sending a project to the app ----------
def ff_preview(src, dst, height):
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", f"scale=-2:'min({height},ih)'", "-c:v", "libx264", "-crf", "28",
         "-preset", "veryfast", "-g", "15", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", dst])


def ff_still(src, dst, at=None, width=800, crop=None):
    pre = ["-ss", f"{at:.2f}"] if at else []
    cr = f"crop={int(crop[2])}:{int(crop[3])}:{int(crop[0])}:{int(crop[1])}," if crop and len(crop) == 4 else ""
    run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y"] + pre + ["-i", src, "-frames:v", "1", "-vf", cr + f"scale='min({width},iw)':-2", dst])


def push(folder, code, force=False):
    import nas_sync as NS
    folder = os.path.abspath(folder)
    doc = json.load(open(os.path.join(folder, "project.json")))
    items = NS.docs("items")
    match = [(k, v) for k, v in items.items() if (v.get("code") or "").upper() == code.upper()]
    if not match:
        sys.exit(f"No video with code {code} in the app.")
    item_id, it = match[0]
    if NS.docs("edits").get(item_id) and not force:
        sys.exit(f"{code} already has a project in the app (and maybe adjustments). Add --force to replace it.")
    base = os.path.join(folder, doc["base"]["path"])
    info = probe(base)
    doc.update(w=doc.get("w") or info["w"], h=doc.get("h") or info["h"], fps=doc.get("fps") or info["fps"], dur=info["dur"])
    rel = os.path.join("Content Video", "Projects", safe_name(code + " " + (it.get("title") or "")))
    dest = os.path.join(S.NAS_ROOT, rel)
    if not os.path.ismount(S.NAS_ROOT):
        sys.exit("The NAS isn't connected on this Mac.")
    print("copying the project to the NAS:", rel)
    shutil.copytree(folder, dest, dirs_exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="gz-push-")
    try:
        pv = os.path.join(tmp, "base.mp4")
        for h in (960, 720, 540):
            ff_preview(base, pv, h)
            if os.path.getsize(pv) <= PREVIEW_MAX_BYTES:
                break
        else:
            sys.exit("The base video is too long for a preview under 19 MB.")
        doc["base"] = {"path": doc["base"]["path"], "url": "/_blob/" + NS.upload(pv, "video/mp4")}
        for L in doc.get("layers", []):
            if L.get("kind") not in ("image", "sticker"):
                continue
            p = os.path.join(folder, L["src"]["path"])
            still = os.path.join(tmp, L["id"] + ".png")
            if L["kind"] == "sticker":
                ff_still(p, still, at=probe(p)["dur"] / 2, crop=L.get("crop"))
            else:
                ff_still(p, still)
            L["src"] = {"path": L["src"]["path"], "url": "/_blob/" + NS.upload(still, "image/png")}
            if not L.get("w"):
                L["w"] = 300
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    now = int(time.time() * 1000)
    doc.update(item=item_id, dir=rel, rev=1, createdAt=now, updatedAt=now, updatedBy=NS.OWNER_ID, render={"state": "idle"})
    NS.put("edits", item_id, doc)
    print(f"done: {code} {it.get('title')} now has an Adjust button in the app ({len(doc.get('layers', []))} layers).")


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) >= 3 and a[0] == "push":
        push(a[1], a[2], "--force" in a)
    elif len(a) == 3 and a[0] == "render":
        d = json.load(open(os.path.join(a[1], "project.json")))
        t = time.time()
        render_project(d, os.path.abspath(a[1]), os.path.abspath(a[2]))
        print(f"rendered {a[2]} in {time.time() - t:.1f} s")
    else:
        print(__doc__)

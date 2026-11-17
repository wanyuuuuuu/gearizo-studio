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


def list_music(docs, put):
    """Background music the team keeps in Content Video/Music on the NAS -> settings/music for the app."""
    os.makedirs(MUSIC_DIR, exist_ok=True)
    files = sorted(f for f in os.listdir(MUSIC_DIR) if f.lower().endswith(AUDIO_EXT) and not f.startswith("."))
    cur = docs("settings").get("music") or {}
    if [x.get("name") for x in cur.get("files", [])] == files:
        return
    out = []
    for f in files[:200]:
        try:
            dur = round(probe_audio(os.path.join(MUSIC_DIR, f)), 1)
        except Exception:
            dur = 0
        out.append({"name": f, "path": "nas:Content Video/Music/" + f, "dur": dur})
    put("settings", "music", {"files": out, "at": int(time.time() * 1000)})


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


def audio_args(doc, proj_dir, dur, first_input):
    """ffmpeg inputs + filter for the background music and voice-over (doc.audio), or a silent track."""
    a = doc.get("audio") or {}
    ins, parts, mix, k = [], [], [], first_input
    bgm, vo = a.get("bgm") or {}, a.get("vo") or {}
    for kind, x in (("bgm", bgm), ("vo", vo)):
        xp = str(x.get("path") or "")
        p = os.path.join(S.NAS_ROOT, xp[4:]) if xp.startswith("nas:") else os.path.join(proj_dir, xp) if xp else ""
        if p and not os.path.isfile(p):
            here = os.path.join(HERE, x["path"])
            p = here if os.path.isfile(here) else ""
        if not p:
            continue
        ins += (["-stream_loop", "-1"] if kind == "bgm" else []) + ["-i", p]
        if kind == "bgm":
            vol = float(x.get("vol", 0.35 if vo.get("path") else 0.8))
            parts.append(f"[{k}:a]atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,volume={vol},afade=t=in:d=0.6,afade=t=out:st={max(0, dur - 1.5):.3f}:d=1.5[bgm]")
            mix.append("[bgm]")
        else:
            at = int(float(x.get("at", 0)) * 1000)
            parts.append(f"[{k}:a]volume={float(x.get('vol', 1))},adelay={at}|{at},apad,atrim=0:{dur:.3f}[vo]")
            mix.append("[vo]")
        k += 1
    if not mix:
        return ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"], [], f"{k}:a"
    parts.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0:duration=longest,atrim=0:{dur:.3f}[aout]" if len(mix) > 1 else parts.pop().rsplit("[", 1)[0] + "[aout]")
    return ins, parts, "[aout]"


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
            ains, aparts, amap = audio_args(doc, proj_dir, info["dur"], n)
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

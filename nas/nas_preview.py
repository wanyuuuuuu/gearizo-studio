#!/usr/bin/env python3
"""Gearizo content studio: find new videos in the NAS item folders and make small previews.

Folders on the NAS share "Marketing Content":
  Content Video/Checking  finished versions waiting for marketing (any file name)
  Content Video/approve   final, approved files (moved here after approval)

Commands (all print JSON):
  check                 -> reads [{"id","title","status","code"}] on stdin;
                           {"mounted", "new":[{path,name,size,mtime,item}]}  item = matched id or null
  preview <video path>  -> {"out","size","duration","trimmed"}
  mark <video path>     -> records the file as processed (same size+mtime is skipped later, even if renamed)
  move <video path> [size mtime]
                        -> moves a file from Checking into approve: {"from","to"}; if the path is gone
                           (file renamed), finds the file in Checking by its size and mtime
"""
import json, os, re, shutil, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settings as S  # noqa: E402

ROOT = S.NAS_ROOT
STUDIO = os.path.join(ROOT, "Gearizo", "Content Studio")   # old per-item layout, no longer used
CHECKING = os.path.join(ROOT, "Content Video", "Checking")
APPROVE = os.path.join(ROOT, "Content Video", "approve")
HOME = S.DATA
STATE = os.path.join(HOME, "processed.json")
PREV = os.path.join(HOME, "previews")
FFMPEG = S.FFMPEG
VIDEO_EXT = (".mp4", ".mov", ".m4v")
SETTLE_SECONDS = 180          # skip files still being copied/exported
LIMIT_BYTES = int(19.5 * 1024 * 1024)
MAX_SECONDS = 480             # previews cover at most the first 8 minutes
CODE_RE = re.compile(r"\[([a-z0-9]{5})\]\s*$", re.I)


def out(obj):
    print(json.dumps(obj, ensure_ascii=False))


def code_for(item_id):
    return item_id[-5:].lower()


def safe_title(title):
    t = re.sub(r'[/\\:*?"<>|]+', "-", str(title or "Untitled"))
    t = re.sub(r"\s+", " ", t).strip()[:60].rstrip(". ")
    return t or "Untitled"


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def key(path, st):
    # size + modified time identify a file even after it is renamed inside the share
    return "%d|%d" % (st.st_size, int(st.st_mtime))


def seen_keys(state):
    out_ = set()
    for k in state:  # older entries were "path|size|mtime"
        parts = k.rsplit("|", 2)
        out_.add(k if len(parts) < 3 else parts[1] + "|" + parts[2])
    return out_


def item_dirs():
    found = {}
    if not os.path.isdir(STUDIO):
        return found
    for name in os.listdir(STUDIO):
        full = os.path.join(STUDIO, name)
        m = CODE_RE.search(name)
        if m and os.path.isdir(full):
            found[m.group(1).lower()] = full
    return found


def norm(t):
    return " " + re.sub(r"[^0-9a-z\u00c0-\uffff]+", " ", str(t).lower()).strip() + " "


CODE_IN_NAME = re.compile(r"(?<![a-z0-9])gz[-_ ]?0*(\d{1,5})(?![0-9])", re.I)


def code_num(code):
    m = re.fullmatch(r"GZ0*(\d{1,5})", str(code or ""), re.I)
    return int(m.group(1)) if m else None


def match_item(filename, items):
    """Item code in the file name (GZ007, gz-7, GZ_007) wins. Otherwise the item whose title appears
    in the file name; longest title wins; ties prefer the one not yet posted."""
    m = CODE_IN_NAME.search(os.path.splitext(filename)[0])
    if m:
        hits = [it for it in items if code_num(it.get("code")) == int(m.group(1))]
        if len(hits) == 1:
            return hits[0]["id"]
    stem = norm(os.path.splitext(filename)[0])
    hits = [it for it in items if len(norm(it.get("title", "")).strip()) >= 3 and norm(it["title"]) in stem]
    if not hits:
        return None
    best = max(len(norm(h["title"])) for h in hits)
    hits = [h for h in hits if len(norm(h["title"])) == best]
    if len(hits) > 1:
        hits = [h for h in hits if h.get("status") != "posted"]
    return hits[0]["id"] if len(hits) == 1 else None


def find_new(items):
    state, now, new = load_state(), time.time(), []
    seen = seen_keys(state)
    if os.path.isdir(CHECKING):
        for dirpath, dirnames, files in os.walk(CHECKING):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in files:
                if fn.startswith(".") or not fn.lower().endswith(VIDEO_EXT):
                    continue
                p = os.path.join(dirpath, fn)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_size == 0 or now - st.st_mtime < SETTLE_SECONDS or key(p, st) in seen:
                    continue
                new.append({"path": p, "name": fn, "size": st.st_size, "mtime": int(st.st_mtime), "item": match_item(fn, items)})
    new.sort(key=lambda x: x["mtime"])
    return new


def cmd_check():
    mounted = os.path.isdir(ROOT) and os.path.ismount(ROOT)
    if not mounted:
        return out({"mounted": False, "new": []})
    try:
        items = json.load(sys.stdin)
    except Exception:
        items = []
    state, now, new = load_state(), time.time(), []
    seen = seen_keys(state)
    if os.path.isdir(CHECKING):
        for dirpath, dirnames, files in os.walk(CHECKING):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in files:
                if fn.startswith(".") or not fn.lower().endswith(VIDEO_EXT):
                    continue
                p = os.path.join(dirpath, fn)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_size == 0 or now - st.st_mtime < SETTLE_SECONDS or key(p, st) in seen:
                    continue
                new.append({"path": p, "name": fn, "size": st.st_size, "mtime": int(st.st_mtime),
                            "item": match_item(fn, items)})
    new.sort(key=lambda x: x["mtime"])
    out({"mounted": True, "new": new})


def cmd_mkfolders():
    if not os.path.ismount(ROOT):
        return out({"mounted": False, "created": []})
    items = json.load(sys.stdin)
    os.makedirs(STUDIO, exist_ok=True)
    have, created = item_dirs(), []
    for it in items:
        c = code_for(it["id"])
        if c in have:
            continue
        path = os.path.join(STUDIO, "%s [%s]" % (safe_title(it.get("title")), c))
        os.makedirs(path, exist_ok=True)
        created.append(path)
    out({"mounted": True, "created": created})


def probe(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 60.0
    v = re.search(r"Video: .*?, (\d{2,5})x(\d{2,5})", r.stderr)
    w, h = (int(v.group(1)), int(v.group(2))) if v else (1080, 1920)
    vline = next((l for l in r.stderr.splitlines() if "Video:" in l), "")
    hdr = ("arib-std-b67" in vline) or ("smpte2084" in vline)
    return dur, w, h, ("Audio:" in r.stderr), hdr


def encode(src, dst, dur, box, kbps, audio, hdr):
    vf = "scale=%d:%d:force_original_aspect_ratio=decrease:force_divisible_by=2" % (box, box)
    if hdr:  # iPhone HLG / HDR10 -> normal (SDR) colours so it looks right in any browser
        vf += (",zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
               "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv")
    vf += ",format=yuv420p"
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-t", str(dur),
           "-map", "0:v:0", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
           "-b:v", "%dk" % kbps, "-maxrate", "%dk" % int(kbps * 1.3), "-bufsize", "%dk" % (kbps * 2)]
    cmd += ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k", "-ac", "2"] if audio else ["-an"]
    cmd += ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-movflags", "+faststart", dst]
    subprocess.run(cmd, check=True)


def cmd_preview(src):
    r = make_preview(src)
    out(r)
    if "error" in r:
        sys.exit(1)


def make_preview(src):
    os.makedirs(PREV, exist_ok=True)
    dur, w, h, audio, hdr = probe(src)
    trimmed = dur > MAX_SECONDS
    dur = min(dur, MAX_SECONDS) or 1
    box = min(960, max(w, h))
    kbps = int(18.0 * 8 * 1024 * 1024 / 1000 / dur) - (96 if audio else 0)
    kbps = max(250, min(2200, int(kbps * 0.95)))
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", os.path.splitext(os.path.basename(src))[0])[:40]
    dst = os.path.join(PREV, "%s-%d.mp4" % (stem, int(time.time())))
    for _ in range(3):
        encode(src, dst, dur, box, kbps, audio, hdr)
        size = os.path.getsize(dst)
        if size <= LIMIT_BYTES:
            return {"out": dst, "size": size, "duration": round(dur, 1), "trimmed": trimmed}
        kbps = max(150, int(kbps * 0.7))
        box = max(540, int(box * 0.85) // 2 * 2)
    os.remove(dst)
    return {"error": "preview_too_large"}


def find_in_checking(size, mtime):
    for dirpath, dirnames, files in os.walk(CHECKING):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in files:
            p = os.path.join(dirpath, fn)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if not fn.startswith(".") and st.st_size == size and int(st.st_mtime) == mtime:
                return p
    return None


def cmd_move(path, size=None, mtime=None):
    r = do_move(path, size, mtime)
    out(r)
    if "error" in r:
        sys.exit(1)


def do_move(path, size=None, mtime=None):
    if not os.path.isfile(path) and size and mtime:
        path = find_in_checking(int(size), int(mtime)) or path
    src = os.path.realpath(path)
    if not src.startswith(os.path.realpath(CHECKING) + os.sep) or not os.path.isfile(src):
        return {"error": "not_in_checking", "from": path}
    os.makedirs(APPROVE, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(src))
    dst, i = os.path.join(APPROVE, base + ext), 2
    while os.path.exists(dst):
        dst, i = os.path.join(APPROVE, "%s (%d)%s" % (base, i, ext)), i + 1
    try:
        os.rename(src, dst)
    except OSError:
        # Some files carry a protected macOS tag (com.apple.macl) that this NAS refuses to rename.
        # Copy the data instead, check it arrived whole, then remove the original from Checking.
        tmp = dst + ".part"
        shutil.copyfile(src, tmp)
        if os.path.getsize(tmp) != os.path.getsize(src):
            os.remove(tmp)
            raise
        os.rename(tmp, dst)
        try:
            os.remove(src)
        except OSError:
            return {"from": path, "to": dst, "original_left": True}
    return {"from": path, "to": dst}


def cmd_mark(path):
    do_mark(path)
    out({"marked": path})


def do_mark(path):
    state = load_state()
    st = os.stat(path)
    state[key(path, st)] = int(time.time())
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, STATE)


if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["check"]:
        cmd_check()
    elif a == ["mkfolders"]:
        cmd_mkfolders()
    elif len(a) == 2 and a[0] == "preview":
        cmd_preview(a[1])
    elif len(a) == 2 and a[0] == "mark":
        cmd_mark(a[1])
    elif len(a) in (2, 4) and a[0] == "move":
        cmd_move(*a[1:])
    else:
        print(__doc__)
        sys.exit(2)

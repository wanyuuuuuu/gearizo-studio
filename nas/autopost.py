"""Gearizo auto-post uploader (runs inside nas_sync.py every few minutes).

For each scheduled video posting on Instagram Reels and/or a Facebook Page within the next 23 hours,
it re-encodes the final file from the NAS to what Meta accepts (see SPEC) and uploads that copy:
  - Instagram: a Reels container, fetched by Meta from a short-lived link (see ig_upload); Instagram only
    publishes on request, so the server publishes it at the time
  - Facebook: a Page Reel scheduled by Meta for the exact time
  - Instagram Carousel (Post): when the version is pictures and "carousel" is ticked, the pictures go up as one
    carousel (one picture: a single photo post), made into JPEGs Instagram takes; the server publishes it at the time
If the item has a cover photo, Instagram gets it as the Reel cover (cover_url) and Facebook as the video's
preferred thumbnail; a cover Meta refuses never stops the post itself.
and records what happened in the "postjobs" collection so the app can show it.
If a post is unscheduled or its caption/time/platforms change, the Facebook schedule is removed and redone.
It never deletes or changes files on the NAS.
"""
import hashlib, json, os, re, shutil, subprocess, time, urllib.error, urllib.parse, urllib.request, uuid

import settings as S

GRAPH = "https://graph.facebook.com/v27.0"
AUTO = ("reel", "fb")
WINDOW_MS = 23 * 3600 * 1000      # Instagram containers last 24 hours
MIN_LEAD_MS = 12 * 60 * 1000      # Facebook needs the time to be more than 10 minutes away
MAX_TRIES = 3


class GraphError(Exception):
    pass


def g(method, path, params, token, timeout=60):
    params = dict(params, access_token=token)
    if method == "GET":
        req = urllib.request.Request(GRAPH + path + "?" + urllib.parse.urlencode(params))
    else:
        req = urllib.request.Request(GRAPH + path, data=urllib.parse.urlencode(params).encode(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
            msg = err.get("error_user_msg") or err.get("message") or str(e)
        except Exception:
            msg = str(e)
        raise GraphError(msg[:300])


def rupload(url, token, path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        req = urllib.request.Request(url, data=f, method="POST", headers={
            "Authorization": "OAuth " + token, "offset": "0", "file_size": str(size),
            "Content-Length": str(size), "Content-Type": "application/octet-stream"})
        try:
            with urllib.request.urlopen(req, timeout=1800) as r:
                out = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            raise GraphError(("Upload failed: " + e.read().decode("utf-8", "replace"))[:300])
    if out.get("success") is False:
        raise GraphError(("Upload failed: " + json.dumps(out))[:300])
    return out


# Meta rejects most phone and Final Cut exports outright, without saying why: they are commonly
# 4K (wider than the 1920 px Reels limit), HEVC, in a QuickTime container, with the moov atom at
# the end of the file. The NAS holds the master and is never touched, so every upload goes out as
# a throwaway re-encode instead -- H.264 High, 1920 on the long edge, AAC 48 kHz, faststart.
SPEC = ("scale='min(1920,iw)':'min(1920,ih)'"
        ":force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p")


SHORT_S = 0.5     # a copy this much shorter than the master is a cut copy


def duration(ff, path):
    """Length in seconds that ffmpeg reads from the file's header, or None."""
    try:
        r = subprocess.run([ff, "-hide_banner", "-i", path], capture_output=True, text=True, timeout=120)
    except Exception:
        return None
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr or "")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None


def encode(path, log):
    """A Reels-ready copy of path in the job's own data folder (or path itself if ffmpeg is gone)."""
    ff = S.FFMPEG if S.FFMPEG and os.path.exists(S.FFMPEG) else shutil.which("ffmpeg")
    if not ff:
        log("autopost: no ffmpeg, sending %s to Meta as it is" % os.path.basename(path))
        return path
    out = os.path.join(S.DATA, "upload-%s.mp4" % hashlib.sha1(path.encode("utf-8")).hexdigest()[:12])
    # The master is read over the network from the NAS. When that read stops early, ffmpeg can still
    # finish "successfully" with a shorter video -- GZ003 went out on 17 Nov at 37 s of its 43. So the
    # copy is measured against the master before anything is uploaded, re-encoded once if it falls
    # short, and never sent short.
    want = duration(ff, path)
    for attempt in (1, 2):
        r = subprocess.run([
            ff, "-y", "-loglevel", "error", "-i", path, "-vf", SPEC, "-r", "30",
            "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "medium",
            "-crf", "23", "-maxrate", "8M", "-bufsize", "16M",
            "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-flags", "+cgop",
            "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", "-f", "mp4", out,
        ], capture_output=True, timeout=3600)
        if r.returncode or not os.path.isfile(out):
            if os.path.exists(out):
                os.remove(out)
            raise GraphError(("ffmpeg: " + (r.stderr or b"").decode("utf-8", "replace").strip())[:300])
        got = duration(ff, out)
        if want is None or (got is not None and got >= want - SHORT_S):
            break
        os.remove(out)
        log("autopost: re-encode of %s came out %.1f s of %.1f s%s" % (os.path.basename(path), got or 0, want,
            ", trying again" if attempt == 1 else ""))
        if attempt == 2:
            raise GraphError("the re-encode came out %.1f s of %.1f s twice (the NAS read stopped early?); not uploading a cut video"
                             % (got or 0, want))
    log("autopost: re-encoded %s for Meta, %.1f MB from %.1f MB, %.1f s"
        % (os.path.basename(path), os.path.getsize(out) / 1e6, os.path.getsize(path) / 1e6, got or 0))
    return out


def sig(it):
    plats = sorted(p for p in it.get("platforms", []) if p in AUTO)
    parts = [it.get("caption", ""), it.get("postAt", 0), plats]
    cover = (it.get("cover") or {}).get("id")
    if cover:   # a new cover re-does the upload; items without one keep their old signature
        parts.append(cover)
    raw = json.dumps(parts, ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def picture_post(item_id, it, versions):
    """The version to post is a set of pictures (a NAS picture folder or images added in the app), not a video:
    Reels, Facebook video and TikTok drafts can't take it. It goes to Instagram as a carousel when "carousel" is
    ticked (run_carousel); anywhere else it is posted by hand."""
    mine = [v for v in versions.values() if v.get("item") == item_id]
    if not mine:
        return False
    want = it.get("submittedV")
    v = next((x for x in mine if want and x.get("n") == want), None) or max(mine, key=lambda x: x.get("n", 0))
    files = v.get("files") or []
    pics = [f for f in files if str(f.get("type", "")).startswith("image/")]
    # pictures, plus at most the PDF they came from
    return (not v.get("asset") and bool(pics) and all(f in pics or f.get("type") == "application/pdf" for f in files)) \
        or (bool(v.get("link")) and os.path.isdir(v["link"]))


def final_file(item_id, it, versions, tiktok=False):
    """The approved version's video on the NAS. For TikTok, its TikTok copy (own end card) when it has one."""
    mine = [v for v in versions.values() if v.get("item") == item_id]
    if not mine:
        return None
    want = it.get("submittedV")
    v = next((x for x in mine if want and x.get("n") == want), None) or max(mine, key=lambda x: x.get("n", 0))
    if tiktok:
        tl = (v.get("tt") or {}).get("link") or ""
        if tl.startswith("/Volumes/") and os.path.isfile(tl):
            return tl
    link = v.get("link") or ""
    return link if link.startswith("/Volumes/") and os.path.isfile(link) else None


# Instagram's direct (resumable) upload processes the video inside the upload request and gives up
# after about 30 s, answering "ProcessingFailedError / Request processing failed". At 1080x1920 that
# is roughly 30 s of footage: a 54 s Reel failed at 9.3 MB and even at 4.2 MB, while 720p at 7.1 MB
# and 1080p 30 s clips went through. Handing Meta a link instead (video_url) has it fetch and
# process in the background with no such limit, so Reels go out that way: the re-encode is put in
# the studio's private storage bucket for the few minutes Meta needs, behind a one-hour signed link,
# and deleted once the container is ready. Direct upload is kept only as the fallback for when the
# bucket cannot be reached.
BUCKET = "media"
READY_WAIT_S = 600


def _storage(method, path, data=None, headers=None, timeout=300):
    h = {"apikey": S.KEY, "Authorization": "Bearer " + S.KEY}
    h.update(headers or {})
    req = urllib.request.Request(S.URL + "/storage/v1/" + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise GraphError(("storage %s: HTTP %s %s" % (method, e.code, e.read().decode("utf-8", "replace")))[:300])


def stash(path, ctype="video/mp4", ext="mp4"):
    """Put path in the storage bucket; returns (object name, one-hour signed link)."""
    obj = "autopost/%s-%d.%s" % (hashlib.sha1(path.encode("utf-8")).hexdigest()[:12], int(time.time()), ext)
    with open(path, "rb") as f:
        _storage("POST", "object/%s/%s" % (BUCKET, obj), f, {
            "Content-Type": ctype, "Content-Length": str(os.path.getsize(path)), "x-upsert": "true"})
    try:
        out = json.loads(_storage("POST", "object/sign/%s/%s" % (BUCKET, obj),
                                  json.dumps({"expiresIn": 3600}).encode(), {"Content-Type": "application/json"}))
        if not out.get("signedURL"):
            raise GraphError("storage sign: no link in %s" % json.dumps(out)[:200])
    except Exception:
        unstash(obj)
        raise
    return obj, S.URL + "/storage/v1" + out["signedURL"]


def unstash(obj):
    try:
        _storage("DELETE", "object/%s/%s" % (BUCKET, obj), timeout=60)
    except Exception:
        pass   # a leftover file costs a little space, never a post


def ready(cid, tok):
    """Waits until Meta has fetched and processed the container; raises if it refuses."""
    waited = 0
    while waited < READY_WAIT_S:
        time.sleep(10)
        waited += 10
        st = g("GET", "/" + cid, {"fields": "status_code,status"}, tok)
        code = st.get("status_code")
        if code == "FINISHED":
            return
        if code in ("ERROR", "EXPIRED"):
            raise GraphError(("Instagram refused the video: %s" % (st.get("status") or code))[:300])
    raise GraphError("Instagram was still processing the video after %d minutes" % (READY_WAIT_S // 60))


def cover_file(it, log):
    """The item's cover photo as a local JPEG for Meta, or None (no cover, or it couldn't be fetched)."""
    oid = (it.get("cover") or {}).get("id")
    if not oid:
        return None
    raw = os.path.join(S.DATA, "cover-src-%s" % oid)
    out = os.path.join(S.DATA, "cover-%s.jpg" % oid)
    try:
        with open(raw, "wb") as f:
            f.write(_storage("GET", "object/%s/%s" % (BUCKET, oid), timeout=120))
        ff = S.FFMPEG if S.FFMPEG and os.path.exists(S.FFMPEG) else shutil.which("ffmpeg")
        if ff:
            for q in (3, 6, 10):   # Instagram: JPEG, sRGB, 8 MB at most
                subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-frames:v", "1",
                                "-vf", "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease,format=yuvj420p",
                                "-q:v", str(q), out], check=True, capture_output=True, timeout=120)
                if os.path.getsize(out) <= 7.5 * 1024 * 1024:
                    break
        else:
            os.replace(raw, out)
        if not os.path.isfile(out) or os.path.getsize(out) > 8 * 1024 * 1024:
            raise GraphError("cover picture is over 8 MB")
        return out
    except Exception as e:
        log("autopost: couldn't prepare the cover of %s, posting without it: %s" % (it.get("title"), e))
        if os.path.exists(out):
            os.remove(out)
        return None
    finally:
        if os.path.exists(raw):
            os.remove(raw)


def ig_upload(m, path, caption, log=lambda s: None, cover=None):
    tokens = [t for t in (m.get("page_token"), m.get("user_token")) if t]
    if not tokens:
        raise GraphError("No Instagram token")
    obj = link = cobj = clink = None
    try:
        obj, link = stash(path)
    except Exception as e:
        log("autopost: couldn't put the video in storage (%s); trying a direct upload instead" % e)
    if cover:
        try:
            cobj, clink = stash(cover, "image/jpeg", "jpg")
        except Exception as e:
            log("autopost: couldn't put the cover in storage (%s); the Reel goes out without it" % e)
    try:
        last = None
        for tok in tokens:
            for cl in ([clink, None] if clink else [None]):   # if Instagram refuses the cover, still post the Reel
                try:
                    params = {"media_type": "REELS", "caption": caption}
                    if cl:
                        params["cover_url"] = cl
                    if link:
                        r = g("POST", "/%s/media" % m["ig_id"], dict(params, video_url=link), tok)
                        ready(r["id"], tok)
                    else:
                        r = g("POST", "/%s/media" % m["ig_id"], dict(params, upload_type="resumable"), tok)
                        rupload(r.get("uri") or "https://rupload.facebook.com/ig-api-upload/v27.0/%s" % r["id"], tok, path)
                    if clink and not cl:
                        log("autopost: Instagram Reel ready without the cover")
                    return r["id"]
                except GraphError as e:
                    last = e
                    if cl:
                        log("autopost: Instagram didn't take the cover (%s); trying without it" % e)
        raise last
    finally:
        if obj:
            unstash(obj)
        if cobj:
            unstash(cobj)


def fb_cover(video_id, cover, tok):
    """Makes the cover the Facebook video's preferred thumbnail (POST /{video}/thumbnails)."""
    b = "----gz" + uuid.uuid4().hex
    with open(cover, "rb") as f:
        img = f.read()
    body = ("--%s\r\nContent-Disposition: form-data; name=\"is_preferred\"\r\n\r\ntrue\r\n"
            "--%s\r\nContent-Disposition: form-data; name=\"access_token\"\r\n\r\n%s\r\n"
            "--%s\r\nContent-Disposition: form-data; name=\"source\"; filename=\"cover.jpg\"\r\n"
            "Content-Type: image/jpeg\r\n\r\n" % (b, b, tok, b)).encode() + img + ("\r\n--%s--\r\n" % b).encode()
    req = urllib.request.Request(GRAPH + "/%s/thumbnails" % video_id, data=body, method="POST",
                                 headers={"Content-Type": "multipart/form-data; boundary=" + b})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
            msg = err.get("error_user_msg") or err.get("message") or str(e)
        except Exception:
            msg = str(e)
        raise GraphError(msg[:300])
    if out.get("success") is False:
        raise GraphError(json.dumps(out)[:300])


def fb_upload(m, path, caption, post_at):
    tok = m["page_token"]
    r = g("POST", "/%s/video_reels" % m["page_id"], {"upload_phase": "start"}, tok)
    vid = r["video_id"]
    rupload(r.get("upload_url") or "https://rupload.facebook.com/video-upload/v27.0/%s" % vid, tok, path)
    g("POST", "/%s/video_reels" % m["page_id"], {"upload_phase": "finish", "video_id": vid, "video_state": "SCHEDULED",
      "scheduled_publish_time": str(int(post_at // 1000)), "description": caption}, tok)
    return vid


# ---------- Instagram Carousel (Post): a picture version, posted as one carousel ----------
# Instagram takes JPEG only, at most 8 MB and 1440 px wide, aspect between 4:5 (portrait) and 1.91:1
# (landscape), up to 20 pictures; a carousel needs at least two, so one picture goes out as a photo post.
# Pictures outside the aspect range are padded with white to fit rather than cropped, so nothing in the
# design is cut off. The first picture sets the shape of the whole carousel in the feed.
CAROUSEL_MAX = 20
IMG_RE = re.compile(r"Video:.*?(\d{2,5})x(\d{2,5})")


def picture_version(item_id, it, versions):
    mine = [v for v in versions.values() if v.get("item") == item_id]
    if not mine:
        return None
    want = it.get("submittedV")
    return next((x for x in mine if want and x.get("n") == want), None) or max(mine, key=lambda x: x.get("n", 0))


def _even(x):
    return max(2, int(round(x / 2.0)) * 2)


def to_jpeg(ff, src, out):
    """src (JPEG, PNG or WebP, any size) -> out: a JPEG Instagram accepts. Returns a note if it had to pad."""
    info = subprocess.run([ff, "-hide_banner", "-i", src], capture_output=True, text=True, timeout=120).stderr or ""
    m = IMG_RE.search(info)
    if not m:
        raise GraphError("couldn't read the picture %s" % os.path.basename(src))
    w, h = int(m.group(1)), int(m.group(2))
    k = min(1.0, 1440.0 / w)
    sw, sh = _even(w * k), _even(h * k)
    cw, ch, note = sw, sh, ""
    if sw / sh < 0.8:
        cw, note = _even(sh * 0.8 + 1), "padded to 4:5"
    elif sw / sh > 1.91:
        ch, note = _even(sw / 1.91 + 1), "padded to 1.91:1"
    graph = ("color=c=white:s=%dx%d[bg];[0:v]scale=%d:%d,format=rgba[fg];"
             "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuvj420p" % (cw, ch, sw, sh))
    for q in (2, 4, 7, 10):
        r = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-filter_complex", graph,
                            "-frames:v", "1", "-q:v", str(q), out], capture_output=True, timeout=120)
        if r.returncode or not os.path.isfile(out):
            raise GraphError(("picture %s: " % os.path.basename(src) + (r.stderr or b"").decode("utf-8", "replace"))[:300])
        if os.path.getsize(out) <= 7.5 * 1024 * 1024:
            return note
    raise GraphError("picture %s is still over 8 MB as a JPEG" % os.path.basename(src))


def carousel_files(v):
    """The pictures of a version in their order: the app's copies (full quality), else the NAS folder."""
    files = [f for f in (v.get("files") or []) if str(f.get("type", "")).startswith("image/") and f.get("id")]
    if files:
        return [("storage", f["id"], f.get("name") or f["id"]) for f in files]
    d = v.get("link") or ""
    if d and os.path.isdir(d):
        names = sorted((n for n in os.listdir(d) if not n.startswith(".") and
                        n.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))),
                       key=lambda n: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", n)])
        return [("nas", os.path.join(d, n), n) for n in names]
    return []


def carousel_sig(it, v, files):
    raw = json.dumps([it.get("caption", ""), it.get("postAt", 0), v.get("n"), [f[1] for f in files]], ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def carousel_upload(m, it, files, log):
    """Builds the carousel container (or a single photo container) on Instagram; returns its id."""
    ff = S.FFMPEG if S.FFMPEG and os.path.exists(S.FFMPEG) else shutil.which("ffmpeg")
    if not ff:
        raise GraphError("no ffmpeg on this computer to make the pictures into JPEGs")
    tag = hashlib.sha1(str(it.get("code") or it.get("title") or "").encode("utf-8")).hexdigest()[:8]
    made, stashed, links = [], [], []
    try:
        for i, (where, ref, name) in enumerate(files[:CAROUSEL_MAX]):
            src = ref
            if where == "storage":
                src = os.path.join(S.DATA, "car-src-%s-%d" % (tag, i))
                with open(src, "wb") as f:
                    f.write(_storage("GET", "object/%s/%s" % (BUCKET, ref), timeout=180))
                made.append(src)
            out = os.path.join(S.DATA, "car-%s-%d.jpg" % (tag, i))
            note = to_jpeg(ff, src, out)
            made.append(out)
            if note:
                log("autopost: %s picture %d (%s) %s for Instagram" % (it.get("title"), i + 1, name, note))
            obj, link = stash(out, "image/jpeg", "jpg")
            stashed.append(obj)
            links.append(link)
        cap = it.get("caption", "")
        last = None
        for tok in [t for t in (m.get("page_token"), m.get("user_token")) if t]:
            try:
                if len(links) == 1:
                    cid = g("POST", "/%s/media" % m["ig_id"], {"image_url": links[0], "caption": cap}, tok)["id"]
                else:
                    kids = [g("POST", "/%s/media" % m["ig_id"], {"image_url": u, "is_carousel_item": "true"}, tok)["id"]
                            for u in links]
                    cid = g("POST", "/%s/media" % m["ig_id"],
                            {"media_type": "CAROUSEL", "children": ",".join(kids), "caption": cap}, tok)["id"]
                ready(cid, tok)
                return cid
            except GraphError as e:
                last = e
        raise last or GraphError("No Instagram token")
    finally:
        for obj in stashed:
            unstash(obj)
        for p in made:
            try:
                os.remove(p)
            except OSError:
                pass


def run_carousel(m, iid, it, versions, job, now, put, log):
    if "carousel" not in it.get("platforms", []) or not m.get("ig_id"):
        return
    at = it.get("postAt") or 0
    if it.get("status") != "scheduled" or not (now + 2 * 60 * 1000 < at < now + WINDOW_MS):
        return
    v = picture_version(iid, it, versions)
    files = carousel_files(v or {})
    if not files:
        return
    s = carousel_sig(it, v, files)
    job = job or {"item": iid}
    c = job.get("carousel") or {}
    if c.get("sig") == s and (c.get("state") in ("uploaded", "posted") or
                              (c.get("state") == "failed" and c.get("tries", 0) >= MAX_TRIES)):
        return
    tries = c.get("tries", 0) + 1 if c.get("sig") == s and c.get("state") == "failed" else 1
    try:
        cid = carousel_upload(m, it, files, log)
        job["carousel"] = {"state": "uploaded", "container": cid, "sig": s, "count": min(len(files), CAROUSEL_MAX), "at": now}
        log("autopost: Instagram carousel ready for %s (%d picture%s)" % (it.get("title"), min(len(files), CAROUSEL_MAX),
                                                                        "" if len(files) == 1 else "s"))
    except Exception as e:
        job["carousel"] = {"state": "failed", "error": str(e)[:300], "sig": s, "tries": tries, "at": now}
        log("autopost: Instagram carousel failed for %s: %s" % (it.get("title"), e))
    put("postjobs", iid, job)


def run(api, docs, put, log, items, versions):
    try:
        rows = api("GET", "/rest/v1/social_meta?id=eq.1&select=page_id,ig_id,page_token,user_token") or []
    except Exception:
        return  # not set up yet (the table is created by supabase/autopost.sql)
    m = rows[0] if rows else None
    if not m or not m.get("page_token"):
        return
    jobs = docs("postjobs")
    now = int(time.time() * 1000)
    for iid, it in items.items():
        if picture_post(iid, it, versions):
            try:
                run_carousel(m, iid, it, versions, jobs.get(iid), now, put, log)   # pictures: IG carousel, if ticked
            except Exception as e:
                log("autopost: carousel of %s: %s" % (it.get("title"), e))
            continue
        job = jobs.get(iid)
        plats = [p for p in it.get("platforms", []) if p in AUTO]
        sched = it.get("status") == "scheduled" and (it.get("postAt") or 0) > 0
        s = sig(it) if sched else ""
        # a Facebook schedule that no longer matches (unscheduled, moved, new caption): remove it
        fb = (job or {}).get("fb") or {}
        if fb.get("state") == "scheduled" and (not sched or "fb" not in plats or fb.get("sig") != s):
            try:
                g("DELETE", "/" + fb["video"], {}, m["page_token"])
            except GraphError as e:
                log("autopost: couldn't remove old Facebook schedule for %s: %s" % (it.get("title"), e))
            job["fb"] = {"state": "cancelled", "at": now}
            put("postjobs", iid, job)
        if not sched or not plats:
            continue
        post_at = it["postAt"]
        if not (now + MIN_LEAD_MS < post_at < now + WINDOW_MS):
            continue
        job = job or {"item": iid}
        igj, fbj = job.get("ig") or {}, job.get("fb") or {}
        def need(j, ok):
            if j.get("sig") != s:
                return True
            if j.get("state") in ok:
                return False
            return j.get("state") != "failed" or j.get("tries", 0) < MAX_TRIES
        need_ig = "reel" in plats and m.get("ig_id") and need(igj, ("uploaded", "posted"))
        need_fb = "fb" in plats and need(fbj, ("scheduled", "posted"))
        if not (need_ig or need_fb):
            continue
        path = final_file(iid, it, versions)
        if not path:
            if job.get("error") != "nofile":
                job["error"] = "nofile"
                put("postjobs", iid, job)
                log("autopost: final video of %s not found on the NAS" % it.get("title"))
            continue
        cap = it.get("caption", "")
        cover = cover_file(it, log)
        try:
            src = encode(path, log)   # one re-encode feeds both uploads
        except Exception as e:
            err = ("encode: " + str(e))[:300]
            if cover and os.path.exists(cover):
                os.remove(cover)
            if job.get("error") != err:
                job["error"] = err
                put("postjobs", iid, job)
                log("autopost: couldn't re-encode %s: %s" % (it.get("title"), e))
            continue
        job.pop("error", None)
        try:
            if need_ig:
                tries = (igj.get("tries", 0) + 1) if igj.get("sig") == s and igj.get("state") == "failed" else 1
                try:
                    job["ig"] = {"state": "uploaded", "container": ig_upload(m, src, cap, log, cover), "sig": s, "at": now, "cover": bool(cover)}
                    log("autopost: Instagram upload ready for %s" % it.get("title"))
                except Exception as e:
                    job["ig"] = {"state": "failed", "error": str(e)[:300], "sig": s, "tries": tries, "at": now}
                    log("autopost: Instagram upload failed for %s: %s" % (it.get("title"), e))
                put("postjobs", iid, job)
            if need_fb:
                tries = (fbj.get("tries", 0) + 1) if fbj.get("sig") == s and fbj.get("state") == "failed" else 1
                try:
                    job["fb"] = {"state": "scheduled", "video": fb_upload(m, src, cap, post_at), "sig": s, "at": now}
                    log("autopost: Facebook reel scheduled for %s" % it.get("title"))
                    if cover:
                        try:
                            fb_cover(job["fb"]["video"], cover, m["page_token"])
                            job["fb"]["cover"] = True
                            log("autopost: Facebook cover set for %s" % it.get("title"))
                        except Exception as e:
                            job["fb"]["cover"] = False
                            job["fb"]["coverError"] = str(e)[:300]
                            log("autopost: Facebook didn't take the cover for %s: %s" % (it.get("title"), e))
                except Exception as e:
                    job["fb"] = {"state": "failed", "error": str(e)[:300], "sig": s, "tries": tries, "at": now}
                    log("autopost: Facebook upload failed for %s: %s" % (it.get("title"), e))
                put("postjobs", iid, job)
        finally:
            for tmp in ([src] if src != path else []) + ([cover] if cover else []):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

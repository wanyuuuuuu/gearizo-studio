#!/usr/bin/env python3
"""Gearizo NAS sync for the standalone app (Supabase). Run every few minutes by launchd.

- New videos in  Marketing Content/Content Video/Checking  -> small preview -> uploaded ->
  a new version of the matching item, sent for review (or "New in Checking" if no match)
- New pictures in Checking whose name has an item's GZ code (or title) -> that item's cover photo
- Items marked approved/posted -> their approved file moves from Checking to approve
- 14 days after a video is posted, its small previews are removed from the app's storage
  (the free plan holds 1 GB). The full video on the NAS is never touched.

It only ever moves files from Checking to approve; it never deletes or renames anything on the NAS.
"""
import fcntl, json, os, re, shutil, subprocess, sys, tempfile, time, traceback, urllib.error, urllib.parse, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settings as S  # noqa: E402
import nas_preview as NP  # noqa: E402
import autopost  # noqa: E402
import tiktok  # noqa: E402
import gz_stats  # noqa: E402
import gz_edit  # noqa: E402
import gz_script  # noqa: E402

URL, KEY = S.URL, S.KEY
OWNER_ID = S.OWNER_ID  # the content owner: versions found on the NAS are credited to them
LOG = os.path.join(S.DATA, "sync.log")
CHECKING_PREFIX = os.path.join(NP.CHECKING, "")
MAX_NEW_PER_RUN = 3
MAX_COVERS_PER_RUN = 5
COVER_SKIPPED = os.path.join(S.DATA, "cover_skipped.json")
KEEP_DAYS = 14          # previews of a posted video are kept this long after posting
MAX_CLEAN_PER_RUN = 20


def log(msg):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    print(line, flush=True)   # shows in `docker logs` when run on the NAS
    with open(LOG, "a") as f:
        f.write(line + "\n")
    # keep the log small
    try:
        if os.path.getsize(LOG) > 400_000:
            lines = open(LOG).readlines()[-2000:]
            open(LOG, "w").writelines(lines)
    except OSError:
        pass


def api(method, path, body=None, headers=None, raw=None):
    h = {"apikey": KEY}
    h.update(headers or {})
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=300) as r:
        t = r.read()
        return json.loads(t) if t and "json" in (r.headers.get("Content-Type") or "") else None


def docs(col):
    rows = api("GET", "/rest/v1/docs?select=id,data&collection=eq." + urllib.parse.quote(col)) or []
    return {d["id"]: d["data"] for d in rows}


def put(col, doc_id, data):
    api("POST", "/rest/v1/docs?on_conflict=collection,id", [{"collection": col, "id": doc_id, "data": data}],
        {"Prefer": "resolution=merge-duplicates,return=minimal"})


def merge(col, doc_id, patch):
    api("POST", "/rest/v1/rpc/doc_merge", {"c": col, "i": doc_id, "patch": patch})


def upload(path, ctype):
    oid = uuid.uuid4().hex
    with open(path, "rb") as f:
        api("POST", "/storage/v1/object/media/" + oid, raw=f.read(), headers={"Content-Type": ctype})
    return oid


def move_cover(item_id, it):
    """A cover picture taken from Checking follows its video into approve."""
    cv = it.get("cover") or {}
    link = cv.get("link") or ""
    if not link.startswith(CHECKING_PREFIX):
        return
    try:
        r = NP.do_move(link, cv.get("size"), cv.get("mtime"))
    except OSError as e:
        log(f"cover move failed for {it.get('title')}, will retry: {e}")
        return
    if "error" in r:
        return
    merge("items", item_id, {"cover": dict(cv, link=r["to"])})
    it["cover"] = dict(cv, link=r["to"])
    log(f"moved the cover of {it.get('title')} -> {r['to']}")


def move_approved(items, versions):
    for item_id, it in items.items():
        if it.get("status") not in ("approved", "scheduled", "posted"):
            continue
        move_cover(item_id, it)
        mine = [(vid, v) for vid, v in versions.items() if v.get("item") == item_id]
        if not mine:
            continue
        want = it.get("submittedV")
        pick = next(((vid, v) for vid, v in mine if want and v.get("n") == want), None) or max(mine, key=lambda x: x[1].get("n", 0))
        vid, v = pick
        move_tiktok(it, vid, v)
        more = v.get("more") or []
        if any(m.startswith(CHECKING_PREFIX) for m in more):
            moved = []
            for m in more:
                if m.startswith(CHECKING_PREFIX):
                    try:
                        r = NP.do_move(m)
                        m = r.get("to") or m
                    except OSError as e:
                        log(f"move failed for a picture of {it.get('title')}, will retry: {e}")
                moved.append(m)
            merge("versions", vid, {"more": moved})
            v["more"] = moved
        link = v.get("link") or ""
        if not link.startswith(CHECKING_PREFIX):
            continue
        try:
            r = NP.do_move(link, v.get("size"), v.get("mtime"))
        except OSError as e:  # NAS hiccup (e.g. right after reconnecting): try again next run
            log(f"move failed for {it.get('title')}, will retry: {e}")
            continue
        if "error" in r:
            log(f"move skipped for {it.get('title')}: {r['error']} ({link})")
            continue
        merge("versions", vid, {"link": r["to"]})
        log(f"moved approved file of {it.get('title')} -> {r['to']}" + (" (copied; the original could not be removed from Checking)" if r.get("original_left") else ""))


def move_tiktok(it, vid, v):
    """The TikTok copy of the approved version follows it into approve (also when it arrives after approval)."""
    tt = v.get("tt") or {}
    link = tt.get("link") or ""
    if not link.startswith(CHECKING_PREFIX):
        return
    try:
        r = NP.do_move(link, tt.get("size"), tt.get("mtime"))
    except OSError as e:
        log(f"TikTok copy move failed for {it.get('title')}, will retry: {e}")
        return
    if "error" in r:
        return
    merge("versions", vid, {"tt": dict(tt, link=r["to"])})
    v["tt"] = dict(tt, link=r["to"])
    log(f"moved the TikTok copy of {it.get('title')} -> {r['to']}")


def nas_file(link):
    """The NAS file a version points to, if it is still there."""
    for pre in ("/Volumes/Marketing Content/", os.path.join(NP.ROOT, "")):
        if link.startswith(pre):
            p = os.path.join(NP.ROOT, link[len(pre):])
            return p if os.path.isfile(p) else None
    return None


def clean_previews(items, versions):
    """Free the app's file storage: remove video previews of videos posted KEEP_DAYS+ days ago.
    Older versions (drafts) lose their preview; the final version only when its full file is on the NAS."""
    now = int(time.time() * 1000)
    done = 0
    for item_id, it in items.items():
        posted = it.get("postedAt") or 0
        if it.get("status") != "posted" or not posted or now - posted < KEEP_DAYS * 86400000:
            continue
        mine = [(vid, v) for vid, v in versions.items() if v.get("item") == item_id]
        if not mine:
            continue
        want = it.get("submittedV")
        final = next((vid for vid, v in mine if want and v.get("n") == want), None) or max(mine, key=lambda x: x[1].get("n", 0))[0]
        for vid, v in mine:
            tta = (v.get("tt") or {}).get("asset") or ""
            if tta.startswith("/_blob/") and nas_file((v.get("tt") or {}).get("link") or ""):
                try:
                    api("DELETE", "/storage/v1/object/media/" + tta[len("/_blob/"):])
                except urllib.error.HTTPError:
                    pass
                merge("versions", vid, {"tt": dict(v["tt"], asset="")})
                v["tt"]["asset"] = ""
            asset = v.get("asset") or ""
            if not asset.startswith("/_blob/") or (v.get("assetType") or "").startswith("image/"):
                continue
            if vid == final and not nas_file(v.get("link") or ""):
                continue  # keep the only viewable copy of the final video
            if any(o.get("asset") == asset for ovid, o in versions.items() if ovid != vid):
                continue  # the same file is used elsewhere
            try:
                api("DELETE", "/storage/v1/object/media/" + asset[len("/_blob/"):])
            except urllib.error.HTTPError as e:
                if e.code not in (400, 404):  # 400/404: already gone
                    log(f"couldn't remove preview v{v.get('n')} of {it.get('title')}: {e}")
                    continue
            merge("versions", vid, {"asset": "", "previewGone": now})
            v["asset"] = ""
            log(f"removed the preview of v{v.get('n')} of {it.get('title')} (posted {(now - posted) // 86400000} days ago)")
            done += 1
            if done >= MAX_CLEAN_PER_RUN:
                return


TT_NAME = re.compile(r"[\s_-]*tik\s*tok\s*$", re.I)
TT_VNUM = re.compile(r"(?<![a-z0-9])v(\d{1,3})(?![0-9])", re.I)
TT_WAIT_LOGGED = set()


def tiktok_file(name):
    """'GZ013 Title v2 TikTok.mp4' -> the TikTok copy of v2 (same video, TikTok's own end card)."""
    return bool(TT_NAME.search(os.path.splitext(name)[0]))


def handle_tiktok_file(f, items, versions):
    """Hang a TikTok copy on its version (the vN in its name, else the latest). It can arrive before, with or long
    after the main file; until that version exists it waits in Checking. Returns True when done with the file."""
    if not f["item"]:
        if f["path"] not in TT_WAIT_LOGGED:
            TT_WAIT_LOGGED.add(f["path"])
            log(f"TikTok file {f['name']} in Checking did not match any item: check the GZ code in its name")
        return False
    stem = TT_NAME.sub("", os.path.splitext(f["name"])[0])
    m = TT_VNUM.findall(stem)
    mine = [(vid, v) for vid, v in versions.items() if v.get("item") == f["item"]]
    pick = None
    if m:
        pick = next(((vid, v) for vid, v in mine if v.get("n") == int(m[-1])), None)
    elif mine:
        pick = max(mine, key=lambda x: x[1].get("n", 0))
    it = items[f["item"]]
    if not pick:
        if f["path"] not in TT_WAIT_LOGGED:
            TT_WAIT_LOGGED.add(f["path"])
            log(f"TikTok file {f['name']} is waiting for v{m[-1] if m else '?'} of {it.get('title')} (the main file) to arrive")
        return False
    vid, v = pick
    pv = NP.make_preview(f["path"])
    asset = ""
    if "error" not in pv:
        try:
            asset = "/_blob/" + upload(pv["out"], "video/mp4")
        finally:
            try:
                os.remove(pv["out"])
            except OSError:
                pass
    old = (v.get("tt") or {}).get("asset") or ""
    tt = {"link": f["path"], "name": f["name"], "asset": asset, "size": f["size"], "mtime": f["mtime"],
          "at": int(time.time() * 1000), "late": it.get("status") in ("approved", "scheduled", "posted")}
    merge("versions", vid, {"tt": tt})
    v["tt"] = tt
    if old.startswith("/_blob/") and old != asset:
        try:
            api("DELETE", "/storage/v1/object/media/" + old[len("/_blob/"):])
        except urllib.error.HTTPError:
            pass
    NP.do_mark(f["path"])
    log(f"added the TikTok copy {f['name']} to v{v.get('n')} of {it.get('title')}" + (" (after approval)" if tt["late"] else ""))
    return True


def handle_new(items, versions):
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", "")} for k, v in items.items()]
    found = NP.find_new(listing)
    # TikTok copies don't take a turn from new videos: they may wait a long time for their main file
    done = 0
    for f in [x for x in found if tiktok_file(x["name"])]:
        if any((x.get("tt") or {}).get("size") == f["size"] and (x.get("tt") or {}).get("mtime") == f["mtime"] for x in versions.values()):
            NP.do_mark(f["path"])
            continue
        if done < 2 and handle_tiktok_file(f, items, versions):
            done += 1
    new = [x for x in found if not tiktok_file(x["name"])][:MAX_NEW_PER_RUN]
    if not new:
        return
    inbox = docs("inbox")
    for f in new:
        dup = any(x.get("size") == f["size"] and x.get("mtime") == f["mtime"] for x in list(versions.values()) + list(inbox.values()))
        if dup:
            NP.do_mark(f["path"])
            continue
        add_file(f, items, versions)


def add_file(f, items, versions, note=None, by=None):
    """A video file in Checking -> small preview -> a new version of its item (sent for review), or New in Checking."""
    pv = NP.make_preview(f["path"])
    if "error" in pv:
        log(f"no preview for {f['name']}: {pv['error']}")
        NP.do_mark(f["path"])
        return
    try:
        oid = upload(pv["out"], "video/mp4")
    finally:
        try:
            os.remove(pv["out"])
        except OSError:
            pass
    note = (note or "From Checking") + ": " + f["name"] + (" (preview shows the first 8 minutes)" if pv.get("trimmed") else "")
    by = by or OWNER_ID
    now = int(time.time() * 1000)
    if f["item"]:
        n = max([v.get("n", 0) for v in versions.values() if v.get("item") == f["item"]] or [0]) + 1
        vdoc = {"item": f["item"], "n": n, "link": f["path"], "asset": "/_blob/" + oid, "assetType": "video/mp4",
                "note": note, "files": [], "size": f["size"], "mtime": f["mtime"], "at": now, "by": by}
        put("versions", f"chk-{f['mtime']}-v{n}", vdoc)
        versions[f"chk-{f['mtime']}-v{n}"] = vdoc
        if items[f["item"]].get("status") != "posted":
            merge("items", f["item"], {"status": "review", "submittedBy": by, "submittedAt": now, "submittedV": n})
        log(f"added v{n} of {items[f['item']].get('title')} from {f['name']} and sent it for review")
    else:
        put("inbox", f"chk-{f['mtime']}-{''.join(c for c in f['name'] if c.isalnum())[:8]}",
            {"path": f["path"], "name": f["name"], "asset": "/_blob/" + oid, "assetType": "video/mp4",
             "size": f["size"], "mtime": f["mtime"], "at": now, "by": OWNER_ID})
        log(f"{f['name']} did not match any item: put in New in Checking")
    NP.do_mark(f["path"])


PIC_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
MAX_SET_PICTURES = 30
PIC_LIMIT = 50 * 1024 * 1024     # the app's storage takes files up to 50 MB


def handle_sets(items, versions):
    """A folder in Checking named with a GZ code, holding pictures (no video) -> one new version with the
    pictures at full quality, sent for review. Changing the folder later makes the next version."""
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", "")} for k, v in items.items()]
    for s in NP.find_new_sets(listing)[:2]:
        if not s["item"]:
            log(f"picture folder {s['name']} in Checking did not match any item: check the GZ code in its name")
            NP.mark_key(s["key"])
            continue
        files, big = [], []
        for p in s["pics"][:MAX_SET_PICTURES]:
            if p["size"] > PIC_LIMIT:
                big.append(p["name"])
                continue
            ctype = PIC_TYPES.get(os.path.splitext(p["name"])[1].lower(), "image/jpeg")
            files.append({"id": upload(p["path"], ctype), "name": p["name"], "type": ctype})
        it = items[s["item"]]
        if not files:
            log(f"picture folder {s['name']}: no picture under 50 MB, nothing added")
            NP.mark_key(s["key"])
            continue
        now = int(time.time() * 1000)
        n = max([v.get("n", 0) for v in versions.values() if v.get("item") == s["item"]] or [0]) + 1
        extra = len(s["pics"]) - MAX_SET_PICTURES
        note = f"From Checking: folder {s['name']} ({len(files)} picture{'s' if len(files) != 1 else ''})" + \
            (f"; left out, over 50 MB: {', '.join(big)}" if big else "") + (f"; only the first {MAX_SET_PICTURES} are shown" if extra > 0 else "")
        vid = f"chk-set-{s['mtime']}-v{n}"
        vdoc = {"item": s["item"], "n": n, "link": s["path"], "asset": "", "assetType": "", "note": note, "files": files,
                "size": s["size"], "mtime": s["mtime"], "at": now, "by": OWNER_ID}
        put("versions", vid, vdoc)
        versions[vid] = vdoc
        if it.get("status") != "posted":
            merge("items", s["item"], {"status": "review", "submittedBy": OWNER_ID, "submittedAt": now, "submittedV": n})
        NP.mark_key(s["key"])
        log(f"added v{n} of {it.get('title')} from picture folder {s['name']} ({len(files)} pictures) and sent it for review")


PDFPAGES_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfpages.swift")
PDFPAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfpages")
MAX_PDF_PAGES = 29          # + the PDF itself = 30 files, what the app shows per version


def pdf_tool():
    """The page renderer, built from pdfpages.swift with the Mac's own Swift compiler when missing or older."""
    if not os.path.isfile(PDFPAGES) or (os.path.isfile(PDFPAGES_SRC) and os.path.getmtime(PDFPAGES_SRC) > os.path.getmtime(PDFPAGES)):
        r = subprocess.run(["swiftc", "-O", PDFPAGES_SRC, "-o", PDFPAGES], capture_output=True, text=True, timeout=600)
        if r.returncode:
            raise RuntimeError("couldn't build pdfpages: " + (r.stderr or "")[-300:])
    return PDFPAGES


def handle_pdfs(items, versions):
    """A PDF in Checking named with a GZ code -> one version: every page as a picture (to review, zoom and comment on
    page by page) plus the PDF itself to download, sent for review. A changed or renamed PDF makes the next version."""
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", "")} for k, v in items.items()]
    for f in NP.find_new_pdfs(listing)[:2]:
        if not f["item"]:
            log(f"PDF {f['name']} in Checking did not match any item: check the GZ code in its name")
            NP.mark_key(f["key"])
            continue
        tmp = tempfile.mkdtemp(prefix="gzpdf-")
        try:
            r = subprocess.run([pdf_tool(), f["path"], tmp, str(MAX_PDF_PAGES), "2000"], capture_output=True, text=True, timeout=900)
            try:
                out = json.loads((r.stdout or "").strip().splitlines()[-1])
            except (ValueError, IndexError):
                out = {"error": (r.stderr or r.stdout or "no output")[-200:]}
            if out.get("error") or not out.get("files"):
                log(f"PDF {f['name']}: couldn't read its pages ({out.get('error') or 'no pages'}), nothing added")
                NP.mark_key(f["key"])
                continue
            stem = os.path.splitext(f["name"])[0]
            files = []
            for i, pth in enumerate(out["files"], 1):
                files.append({"id": upload(pth, "image/jpeg"), "name": f"{stem} p{i}.jpg", "type": "image/jpeg"})
            if f["size"] <= PIC_LIMIT:
                files.append({"id": upload(f["path"], "application/pdf"), "name": f["name"], "type": "application/pdf"})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        it = items[f["item"]]
        now = int(time.time() * 1000)
        n = max([v.get("n", 0) for v in versions.values() if v.get("item") == f["item"]] or [0]) + 1
        total, shown = out.get("total") or len(out["files"]), len(out["files"])
        note = f"From Checking: {f['name']} ({total} page{'s' if total != 1 else ''})" + \
            (f"; only the first {shown} pages are shown, the PDF has them all" if total > shown else "") + \
            ("" if f["size"] <= PIC_LIMIT else "; the PDF itself is over 50 MB, so it stays on the NAS only")
        vid = f"chk-pdf-{f['mtime']}-v{n}"
        vdoc = {"item": f["item"], "n": n, "link": f["path"], "asset": "", "assetType": "", "note": note, "files": files,
                "size": f["size"], "mtime": f["mtime"], "at": now, "by": OWNER_ID}
        put("versions", vid, vdoc)
        versions[vid] = vdoc
        if it.get("status") != "posted":
            merge("items", f["item"], {"status": "review", "submittedBy": OWNER_ID, "submittedAt": now, "submittedV": n})
        NP.mark_key(f["key"])
        log(f"added v{n} of {it.get('title')} from {f['name']} ({shown} page{'s' if shown != 1 else ''}) and sent it for review")


def handle_design_pics(items, versions):
    """Loose pictures for a design item -> one new version per vN group, full quality, sent for review."""
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", ""), "type": v.get("type", "")} for k, v in items.items()]
    for g in NP.find_new_design_pics(listing)[:2]:
        files, big = [], []
        for p in g["pics"][:MAX_SET_PICTURES]:
            if p["size"] > PIC_LIMIT:
                big.append(p["name"])
                continue
            ctype = PIC_TYPES.get(os.path.splitext(p["name"])[1].lower(), "image/jpeg")
            files.append({"id": upload(p["path"], ctype), "name": p["name"], "type": ctype})
        it = items[g["item"]]
        if not files:
            log(f"pictures for {it.get('title')}: none under 50 MB, nothing added")
            NP.mark_key(g["key"])
            continue
        now = int(time.time() * 1000)
        n = max([v.get("n", 0) for v in versions.values() if v.get("item") == g["item"]] or [0]) + 1
        names = ", ".join(p["name"] for p in g["pics"][:3]) + (" …" if len(g["pics"]) > 3 else "")
        note = f"From Checking: {names}" + (f"; left out, over 50 MB: {', '.join(big)}" if big else "")
        paths = [p["path"] for p in g["pics"]]
        vid = f"chk-dpic-{g['mtime']}-v{n}"
        vdoc = {"item": g["item"], "n": n, "link": paths[0], "more": paths[1:], "asset": "", "assetType": "", "note": note,
                "files": files, "size": g["size"], "mtime": g["mtime"], "at": now, "by": OWNER_ID}
        put("versions", vid, vdoc)
        versions[vid] = vdoc
        if it.get("status") != "posted":
            merge("items", g["item"], {"status": "review", "submittedBy": OWNER_ID, "submittedAt": now, "submittedV": n})
        NP.mark_key(g["key"])
        log(f"added v{n} of {it.get('title')} from {len(files)} picture{'s' if len(files) != 1 else ''} in Checking and sent it for review")


def handle_covers(items):
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", ""), "type": v.get("type", "")} for k, v in items.items()]
    try:
        skipped = json.load(open(COVER_SKIPPED))
    except Exception:
        skipped = {}
    # pictures with no GZ code that were already reported don't take a turn, so they can't block real covers
    new = [f for f in NP.find_new_covers(listing) if f["item"] or "%s|%d|%d" % (f["path"], f["size"], f["mtime"]) not in skipped]
    new = sorted(new, key=lambda f: not f["item"])[:MAX_COVERS_PER_RUN]
    if not new:
        return
    noted = False
    for f in new:
        if not f["item"]:
            k = "%s|%d|%d" % (f["path"], f["size"], f["mtime"])
            if k not in skipped:   # say it once; it is picked up as soon as it is renamed with a GZ code
                skipped[k] = int(time.time())
                noted = True
                log(f"picture {f['name']} in Checking did not match any item: put its GZ code in the name to use it as a cover")
            continue
        cur = items[f["item"]].get("cover") or {}
        if cur.get("id") and cur.get("from") != "nas" and int(cur.get("at") or 0) > f["mtime"] * 1000:
            log(f"kept the newer cover set in the app for {items[f['item']].get('title')}; not using {f['name']}")
            NP.do_mark(f["path"])
            continue
        cv = NP.make_cover(f["path"])
        if "error" in cv:
            log(f"couldn't use {f['name']} as a cover: {cv['error']}")
            NP.do_mark(f["path"])
            continue
        try:
            oid = upload(cv["out"], "image/jpeg")
        finally:
            try:
                os.remove(cv["out"])
            except OSError:
                pass
        it = items[f["item"]]
        old = (it.get("cover") or {}).get("id")
        cover = {"id": oid, "name": f["name"], "type": "image/jpeg", "link": f["path"], "size": f["size"],
                 "mtime": f["mtime"], "at": int(time.time() * 1000), "from": "nas"}
        merge("items", f["item"], {"cover": cover})
        it["cover"] = cover
        if old and old != oid:
            try:
                api("DELETE", "/storage/v1/object/media/" + old)
            except urllib.error.HTTPError:
                pass  # already gone
        NP.do_mark(f["path"])
        log(f"set the cover of {it.get('title')} from {f['name']}")
    if noted:
        keep = dict(sorted(skipped.items(), key=lambda kv: kv[1])[-300:])
        with open(COVER_SKIPPED, "w") as fh:
            json.dump(keep, fh)


def run():
    lock = open(os.path.join(S.DATA, ".sync.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # a previous run is still working
    status = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "nas_mounted": os.path.ismount(NP.ROOT)}
    try:
        status["checking_files"] = len(os.listdir(NP.CHECKING)) if status["nas_mounted"] else None
    except OSError as e:
        status["checking_error"] = str(e)
    status["sync"], status["autopost"] = S.SYNC, S.AUTOPOST
    with open(os.path.join(S.DATA, "status.json"), "w") as f:
        json.dump(status, f)
    try:                       # scripts don't need the NAS
        gz_script.handle_scripts(docs, merge, log)
        gz_script.handle_films(docs, merge, put, log)
    except Exception:
        log("script ERROR " + traceback.format_exc().strip().replace("\n", " | "))
    try:                       # voice-overs don't need the NAS either
        gz_edit.handle_vo(docs, merge, log)
    except Exception:
        log("vo ERROR " + traceback.format_exc().strip().replace("\n", " | "))
    if not status["nas_mounted"] or "checking_error" in status:
        return
    items, versions = docs("items"), docs("versions")
    if S.SYNC:
        move_approved(items, versions)
        handle_new(items, versions)
        try:
            handle_sets(items, versions)
        except Exception:
            log("picture folder ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            handle_design_pics(items, versions)
        except Exception:
            log("design pictures ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            handle_pdfs(items, versions)
        except Exception:
            log("PDF ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            handle_covers(items)
        except Exception:
            log("cover ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            clean_previews(items, versions)
        except Exception:
            log("cleanup ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            gz_edit.list_music(docs, put)
            gz_edit.handle_cutouts(docs, merge, log)
        except Exception:
            log("music/cutout ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            gz_edit.handle_talking(docs, put, log, items)
        except Exception:
            log("口播 ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        try:
            gz_edit.handle_renders(api, docs, merge, log, items, versions, add_file)
        except Exception:
            log("render ERROR " + traceback.format_exc().strip().replace("\n", " | "))
    if not S.AUTOPOST:
        return
    try:
        autopost.run(api, docs, put, log, items, docs("versions"))
    except Exception:
        log("autopost ERROR " + traceback.format_exc().strip().replace("\n", " | "))
    try:
        tiktok.run(api, docs, put, merge, log, items, docs("versions"))
    except Exception:
        log("tiktok ERROR " + traceback.format_exc().strip().replace("\n", " | "))
    try:
        gz_stats.run(api, docs, put, log, items)
    except Exception:
        log("stats ERROR " + traceback.format_exc().strip().replace("\n", " | "))


if __name__ == "__main__":
    try:
        run()
    except Exception:
        log("ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        sys.exit(1)

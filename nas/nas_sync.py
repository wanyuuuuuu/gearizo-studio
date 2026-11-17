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
import fcntl, json, os, sys, time, traceback, urllib.error, urllib.parse, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settings as S  # noqa: E402
import nas_preview as NP  # noqa: E402
import autopost  # noqa: E402
import tiktok  # noqa: E402
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


def handle_new(items, versions):
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", "")} for k, v in items.items()]
    new = NP.find_new(listing)[:MAX_NEW_PER_RUN]
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


def handle_covers(items):
    listing = [{"id": k, "title": v.get("title", ""), "status": v.get("status", ""), "code": v.get("code", "")} for k, v in items.items()]
    new = NP.find_new_covers(listing)[:MAX_COVERS_PER_RUN]
    if not new:
        return
    try:
        skipped = json.load(open(COVER_SKIPPED))
    except Exception:
        skipped = {}
    noted = False
    for f in new:
        if not f["item"]:
            k = "%s|%d|%d" % (f["path"], f["size"], f["mtime"])
            if k not in skipped:   # say it once; it is picked up as soon as it is renamed with a GZ code
                skipped[k] = int(time.time())
                noted = True
                log(f"picture {f['name']} in Checking did not match any item: put its GZ code in the name to use it as a cover")
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
    if not status["nas_mounted"] or "checking_error" in status:
        return
    items, versions = docs("items"), docs("versions")
    if S.SYNC:
        move_approved(items, versions)
        handle_new(items, versions)
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


if __name__ == "__main__":
    try:
        run()
    except Exception:
        log("ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        sys.exit(1)

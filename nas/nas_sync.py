#!/usr/bin/env python3
"""Gearizo NAS sync for the standalone app (Supabase). Run every few minutes by launchd.

- New videos in  Marketing Content/Content Video/Checking  -> small preview -> uploaded ->
  a new version of the matching item, sent for review (or "New in Checking" if no match)
- Items marked approved/posted -> their approved file moves from Checking to approve

It only ever moves files from Checking to approve; it never deletes or renames anything on the NAS.
"""
import fcntl, json, os, sys, time, traceback, urllib.parse, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settings as S  # noqa: E402
import nas_preview as NP  # noqa: E402
import autopost  # noqa: E402

URL, KEY = S.URL, S.KEY
OWNER_ID = S.OWNER_ID  # the content owner: versions found on the NAS are credited to them
LOG = os.path.join(S.DATA, "sync.log")
CHECKING_PREFIX = os.path.join(NP.CHECKING, "")
MAX_NEW_PER_RUN = 3


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


def move_approved(items, versions):
    for item_id, it in items.items():
        if it.get("status") not in ("approved", "scheduled", "posted"):
            continue
        mine = [(vid, v) for vid, v in versions.items() if v.get("item") == item_id]
        if not mine:
            continue
        want = it.get("submittedV")
        pick = next(((vid, v) for vid, v in mine if want and v.get("n") == want), None) or max(mine, key=lambda x: x[1].get("n", 0))
        vid, v = pick
        link = v.get("link") or ""
        if not link.startswith(CHECKING_PREFIX):
            continue
        r = NP.do_move(link, v.get("size"), v.get("mtime"))
        if "error" in r:
            log(f"move skipped for {it.get('title')}: {r['error']} ({link})")
            continue
        merge("versions", vid, {"link": r["to"]})
        log(f"moved approved file of {it.get('title')} -> {r['to']}")


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
        pv = NP.make_preview(f["path"])
        if "error" in pv:
            log(f"no preview for {f['name']}: {pv['error']}")
            NP.do_mark(f["path"])
            continue
        try:
            oid = upload(pv["out"], "video/mp4")
        finally:
            try:
                os.remove(pv["out"])
            except OSError:
                pass
        note = "From Checking: " + f["name"] + (" (preview shows the first 8 minutes)" if pv.get("trimmed") else "")
        now = int(time.time() * 1000)
        if f["item"]:
            n = max([v.get("n", 0) for v in versions.values() if v.get("item") == f["item"]] or [0]) + 1
            vdoc = {"item": f["item"], "n": n, "link": f["path"], "asset": "/_blob/" + oid, "assetType": "video/mp4",
                    "note": note, "files": [], "size": f["size"], "mtime": f["mtime"], "at": now, "by": OWNER_ID}
            put("versions", f"chk-{f['mtime']}-v{n}", vdoc)
            versions[f"chk-{f['mtime']}-v{n}"] = vdoc
            if items[f["item"]].get("status") != "posted":
                merge("items", f["item"], {"status": "review", "submittedBy": OWNER_ID, "submittedAt": now, "submittedV": n})
            log(f"added v{n} of {items[f['item']].get('title')} from {f['name']} and sent it for review")
        else:
            put("inbox", f"chk-{f['mtime']}-{''.join(c for c in f['name'] if c.isalnum())[:8]}",
                {"path": f["path"], "name": f["name"], "asset": "/_blob/" + oid, "assetType": "video/mp4",
                 "size": f["size"], "mtime": f["mtime"], "at": now, "by": OWNER_ID})
            log(f"{f['name']} did not match any item: put in New in Checking")
        NP.do_mark(f["path"])


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
    if not status["nas_mounted"] or "checking_error" in status:
        return
    items, versions = docs("items"), docs("versions")
    if S.SYNC:
        move_approved(items, versions)
        handle_new(items, versions)
    if not S.AUTOPOST:
        return
    try:
        autopost.run(api, docs, put, log, items, docs("versions"))
    except Exception:
        log("autopost ERROR " + traceback.format_exc().strip().replace("\n", " | "))


if __name__ == "__main__":
    try:
        run()
    except Exception:
        log("ERROR " + traceback.format_exc().strip().replace("\n", " | "))
        sys.exit(1)

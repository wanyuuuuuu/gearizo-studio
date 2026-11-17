"""TikTok drafts (runs inside nas_sync.py after autopost).

For each scheduled video that goes to a connected Gearizo TikTok account -- tt_gz (TT Main, @gearizo),
tt_my (TT CN, @gearizomy), tt_sg (TT SG, @gearizo.sg) -- it sends the final video to that account's
TikTok inbox a few minutes before the time. TikTok notifies the account; whoever posts opens the
notification, adds the caption from the studio and posts it there. The server (notify, postdue)
renews the sign-ins and follows each draft until it is posted.

TikTok's inbox upload carries no caption, and until the developer app passes TikTok's review it
only reaches the accounts added as Sandbox target users. At most 5 drafts per account may wait
unposted in any 24 hours.

Status goes to the item's "postjobs" record under the slot's own key ("tt_my": {...}), written with
a merge so it never overwrites what autopost or the server wrote. It never changes files on the NAS.
"""
import datetime, json, os, time, urllib.error, urllib.request

import autopost as A

API = "https://open.tiktokapis.com/v2"
SLOTS = {"tt_gz": "TT Main", "tt_my": "TT CN", "tt_sg": "TT SG"}
LEAD_MS = 5 * 60 * 1000          # send this long before the time, so the draft is waiting when it's due
LATE_MS = 12 * 3600 * 1000       # still send if the Mac was off at the time, up to this long after
MAX_TRIES = 3
WHOLE_MAX = 60_000_000           # up to this size the file goes up in one piece (TikTok allows 64 MB)
CHUNK = 10_000_000               # larger files: 10 MB pieces, the last one takes the remainder


class TikTokError(Exception):
    pass


def call(path, token, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json; charset=UTF-8"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            j = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read() or b"{}")
        except ValueError:
            raise TikTokError("TikTok answered %s" % e.code)
    err = j.get("error") or {}
    if err.get("code") not in (None, "", "ok"):
        raise TikTokError(("%s: %s" % (err.get("code"), err.get("message") or "")).strip(": ")[:300])
    return j.get("data") or {}


def pieces(size):
    """(chunk_size, total_chunk_count) the way TikTok counts them: floor(size / chunk), last piece absorbs the rest."""
    if size <= WHOLE_MAX:
        return size, 1
    return CHUNK, size // CHUNK


def send(token, path):
    """Uploads path to the account's TikTok inbox; returns TikTok's publish_id."""
    size = os.path.getsize(path)
    chunk, count = pieces(size)
    d = call("/post/publish/inbox/video/init/", token, {"source_info": {
        "source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk, "total_chunk_count": count}})
    url, pid = d.get("upload_url"), d.get("publish_id")
    if not url or not pid:
        raise TikTokError("TikTok gave no upload address")
    with open(path, "rb") as f:
        for i in range(count):
            first = i * chunk
            last = size - 1 if i == count - 1 else first + chunk - 1
            f.seek(first)
            data = f.read(last - first + 1)
            req = urllib.request.Request(url, data=data, method="PUT", headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(data)),
                "Content-Range": "bytes %d-%d/%d" % (first, last, size)})
            try:
                with urllib.request.urlopen(req, timeout=900) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                raise TikTokError(("upload part %d of %d: HTTP %s %s" % (i + 1, count, e.code,
                                   e.read().decode("utf-8", "replace")))[:300])
            if code not in (200, 201, 206):
                raise TikTokError("upload part %d of %d: HTTP %s" % (i + 1, count, code))
    return pid


def expired(row):
    t = row.get("access_expires_at") or ""
    try:
        return datetime.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() < time.time() + 60
    except ValueError:
        return False


def run(api, docs, put, merge, log, items, versions):
    try:
        rows = api("GET", "/rest/v1/social_tiktok?select=slot,display_name,access_token,access_expires_at") or []
    except Exception:
        return   # not set up yet (the tables come from supabase/tiktok.sql)
    acct = {r["slot"]: r for r in rows if r.get("access_token") and r.get("slot") in SLOTS}
    if not acct:
        return
    jobs = docs("postjobs")
    now = int(time.time() * 1000)
    for iid, it in items.items():
        at = it.get("postAt") or 0
        if it.get("status") != "scheduled" or not at or not (at - LEAD_MS <= now <= at + LATE_MS):
            continue
        job = jobs.get(iid)
        todo = []
        for s in (p for p in it.get("platforms", []) if p in acct):
            j = (job or {}).get(s) or {}
            if j.get("state") in ("sent", "inbox", "posted"):
                continue
            if j.get("state") == "failed" and j.get("tries", 0) >= MAX_TRIES:
                continue
            todo.append(s)
        if not todo:
            continue

        def save(s, rec):
            nonlocal job
            if job is None:                        # no record yet: create it (merge needs one to exist)
                job = {"item": iid, s: rec}
                put("postjobs", iid, job)
            else:
                job[s] = rec
                merge("postjobs", iid, {s: rec})

        path = A.final_file(iid, it, versions)
        if not path:
            new = [s for s in todo if ((job or {}).get(s) or {}).get("error") != "nofile"]
            for s in new:
                save(s, {"state": "waiting", "error": "nofile", "at": now})
            if new:
                log("tiktok: final video of %s not found on the NAS" % it.get("title"))
            continue
        try:
            src = A.encode(path, log)              # the same H.264 1080p copy Instagram gets
        except Exception as e:
            log("tiktok: couldn't re-encode %s: %s" % (it.get("title"), e))
            continue
        try:
            for s in todo:
                a, prev = acct[s], (job or {}).get(s) or {}
                tries = prev.get("tries", 0) + 1 if prev.get("state") == "failed" else 1
                if expired(a):
                    save(s, {"state": "failed", "error": "TikTok sign-in expired. Connect %s again in Team > Social." % SLOTS[s],
                             "tries": tries, "at": now})
                    continue
                try:
                    pid = send(a["access_token"], src)
                    save(s, {"state": "sent", "publish_id": pid, "at": now})
                    log("tiktok: %s sent to %s drafts (%s)" % (it.get("title"), SLOTS[s], a.get("display_name") or s))
                except Exception as e:
                    save(s, {"state": "failed", "error": str(e)[:300], "tries": tries, "at": now})
                    log("tiktok: %s couldn't go to %s: %s" % (it.get("title"), SLOTS[s], e))
        finally:
            if src != path:
                try:
                    os.remove(src)
                except OSError:
                    pass

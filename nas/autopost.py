"""Gearizo auto-post uploader (runs inside nas_sync.py every few minutes).

For each scheduled video posting on Instagram Reels and/or a Facebook Page within the next 23 hours,
it uploads the final file from the NAS:
  - Instagram: a Reels container (Instagram only publishes on request; the server publishes it at the time)
  - Facebook: a Page Reel scheduled by Meta for the exact time
and records what happened in the "postjobs" collection so the app can show it.
If a post is unscheduled or its caption/time/platforms change, the Facebook schedule is removed and redone.
It never deletes or changes files on the NAS.
"""
import hashlib, json, os, time, urllib.error, urllib.parse, urllib.request

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


def sig(it):
    plats = sorted(p for p in it.get("platforms", []) if p in AUTO)
    raw = json.dumps([it.get("caption", ""), it.get("postAt", 0), plats], ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def final_file(item_id, it, versions):
    mine = [v for v in versions.values() if v.get("item") == item_id]
    if not mine:
        return None
    want = it.get("submittedV")
    v = next((x for x in mine if want and x.get("n") == want), None) or max(mine, key=lambda x: x.get("n", 0))
    link = v.get("link") or ""
    return link if link.startswith("/Volumes/") and os.path.isfile(link) else None


def ig_upload(m, path, caption):
    tokens = [t for t in (m.get("page_token"), m.get("user_token")) if t]
    last = None
    for tok in tokens:
        try:
            r = g("POST", "/%s/media" % m["ig_id"], {"media_type": "REELS", "upload_type": "resumable", "caption": caption}, tok)
            cid = r["id"]
            rupload(r.get("uri") or "https://rupload.facebook.com/ig-api-upload/v27.0/%s" % cid, tok, path)
            return cid
        except GraphError as e:
            last = e
    raise last or GraphError("No Instagram token")


def fb_upload(m, path, caption, post_at):
    tok = m["page_token"]
    r = g("POST", "/%s/video_reels" % m["page_id"], {"upload_phase": "start"}, tok)
    vid = r["video_id"]
    rupload(r.get("upload_url") or "https://rupload.facebook.com/video-upload/v27.0/%s" % vid, tok, path)
    g("POST", "/%s/video_reels" % m["page_id"], {"upload_phase": "finish", "video_id": vid, "video_state": "SCHEDULED",
      "scheduled_publish_time": str(int(post_at // 1000)), "description": caption}, tok)
    return vid


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
        job.pop("error", None)
        cap = it.get("caption", "")
        if need_ig:
            tries = (igj.get("tries", 0) + 1) if igj.get("sig") == s and igj.get("state") == "failed" else 1
            try:
                job["ig"] = {"state": "uploaded", "container": ig_upload(m, path, cap), "sig": s, "at": now}
                log("autopost: Instagram upload ready for %s" % it.get("title"))
            except Exception as e:
                job["ig"] = {"state": "failed", "error": str(e)[:300], "sig": s, "tries": tries, "at": now}
                log("autopost: Instagram upload failed for %s: %s" % (it.get("title"), e))
            put("postjobs", iid, job)
        if need_fb:
            tries = (fbj.get("tries", 0) + 1) if fbj.get("sig") == s and fbj.get("state") == "failed" else 1
            try:
                job["fb"] = {"state": "scheduled", "video": fb_upload(m, path, cap, post_at), "sig": s, "at": now}
                log("autopost: Facebook reel scheduled for %s" % it.get("title"))
            except Exception as e:
                job["fb"] = {"state": "failed", "error": str(e)[:300], "sig": s, "tries": tries, "at": now}
                log("autopost: Facebook upload failed for %s: %s" % (it.get("title"), e))
            put("postjobs", iid, job)

"""Numbers for posted videos: views, likes, comments, shares, saves and reach per platform.

Runs on the Mac that does the auto-posting (it holds the Meta and TikTok tokens).
Writes docs collection "stats", one doc per item:
  {item, at, p: {ig|fb|tt_gz|tt_my|tt_sg: {views, likes, comments, shares, saves, reach, url, at}},
   h: [[ms, views, likes], ...] (one point per check, at most 80), need: [what permission is missing]}
How often: first 2 days every 3 hours, then every 12 hours up to 30 days, daily up to 90 days, then it stops.
Instagram posts are found by the auto-post media id, or by the post link saved in Publish (matched against
the account's latest posts). TikTok videos are posted by hand from drafts, so they are matched by time:
the first video on that account after the draft was sent.
"""
import json, time, urllib.error, urllib.request

import autopost

HOUR = 3600 * 1000
DAY = 24 * HOUR
TT_API = "https://open.tiktokapis.com/v2"
TT_SLOTS = ("tt_gz", "tt_my", "tt_sg")
IG_METRICS = "views,reach,saved,shares"


def every(age):
    if age < 2 * DAY:
        return 3 * HOUR
    if age < 30 * DAY:
        return 12 * HOUR
    if age < 90 * DAY:
        return DAY
    return None


def _n(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def _short(url):
    """Instagram post code from a link (…/reel/ABC123/ or …/p/ABC123/)."""
    parts = [p for p in str(url or "").split("?")[0].split("/") if p]
    for i, p in enumerate(parts):
        if p in ("reel", "reels", "p", "tv") and i + 1 < len(parts):
            return parts[i + 1]
    return ""


class Meta:
    def __init__(self, m, log):
        self.m, self.log, self.recent, self.no_insights = m, log, None, False

    def g(self, path, params):
        last = None
        for tok in [t for t in (self.m.get("page_token"), self.m.get("user_token")) if t]:
            try:
                return autopost.g("GET", path, params, tok)
            except autopost.GraphError as e:
                last = e
        raise last or autopost.GraphError("no token")

    def ig_recent(self):
        if self.recent is None:
            self.recent = {}
            if self.m.get("ig_id"):
                try:
                    r = self.g("/%s/media" % self.m["ig_id"], {"fields": "id,permalink,timestamp", "limit": "60"})
                    for x in r.get("data", []):
                        self.recent[_short(x.get("permalink"))] = x["id"]
                except autopost.GraphError as e:
                    self.log("stats: couldn't list Instagram posts: %s" % e)
        return self.recent

    def ig(self, media):
        r = self.g("/" + media, {"fields": "like_count,comments_count,permalink"})
        out = {"likes": _n(r.get("like_count")), "comments": _n(r.get("comments_count")), "url": r.get("permalink") or ""}
        if not self.no_insights:
            try:
                ins = self.g("/%s/insights" % media, {"metric": IG_METRICS})
                for x in ins.get("data", []):
                    v = (x.get("values") or [{}])[0].get("value")
                    key = {"saved": "saves"}.get(x.get("name"), x.get("name"))
                    out[key] = _n(v)
            except autopost.GraphError as e:
                if "permission" in str(e).lower():
                    self.no_insights = True
                else:
                    self.log("stats: Instagram insights for %s: %s" % (media, e))
        return out

    def fb(self, video):
        r = self.g("/" + video, {"fields": "views,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)"})
        url = r.get("permalink_url") or ""
        if url.startswith("/"):
            url = "https://www.facebook.com" + url
        return {"views": _n(r.get("views")), "likes": _n(((r.get("likes") or {}).get("summary") or {}).get("total_count")),
                "comments": _n(((r.get("comments") or {}).get("summary") or {}).get("total_count")), "url": url}


class TikTok:
    """video.list needs the video.list permission; until then every call says scope_not_authorized."""
    def __init__(self, rows, log):
        self.acct, self.log, self.lists, self.no_scope = rows, log, {}, set()

    def videos(self, slot):
        if slot in self.lists:
            return self.lists[slot]
        out, a = [], self.acct.get(slot)
        self.lists[slot] = out
        if not a:
            return out
        fields = "id,create_time,share_url,view_count,like_count,comment_count,share_count,video_description,title"
        req = urllib.request.Request(TT_API + "/video/list/?fields=" + fields, data=json.dumps({"max_count": 20}).encode(),
                                     method="POST", headers={"Authorization": "Bearer " + a["access_token"],
                                                             "Content-Type": "application/json; charset=UTF-8"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                j = json.loads(e.read() or b"{}")
            except ValueError:
                j = {"error": {"code": str(e.code)}}
        code = (j.get("error") or {}).get("code")
        if code not in (None, "", "ok"):
            if "scope" in str(code):
                self.no_scope.add(slot)
            else:
                self.log("stats: TikTok %s list: %s" % (slot, code))
            return out
        out.extend((j.get("data") or {}).get("videos") or [])
        return out

    def match(self, slot, sent_at, known_id):
        vids = self.videos(slot)
        if known_id:
            v = next((x for x in vids if x.get("id") == known_id), None)
            if v:
                return v
        after = [x for x in vids if (x.get("create_time") or 0) * 1000 >= sent_at - 10 * 60 * 1000]
        return min(after, key=lambda x: x.get("create_time") or 0) if after else None


def run(api, docs, put, log, items):
    try:
        rows = api("GET", "/rest/v1/social_meta?id=eq.1&select=ig_id,page_token,user_token") or []
    except Exception:
        rows = []
    meta = Meta(rows[0], log) if rows and rows[0].get("page_token") else None
    try:
        tt_rows = api("GET", "/rest/v1/social_tiktok?select=slot,access_token") or []
    except Exception:
        tt_rows = []
    tt = TikTok({r["slot"]: r for r in tt_rows if r.get("access_token")}, log)
    jobs, stats = docs("postjobs"), docs("stats")
    now = int(time.time() * 1000)
    taken = {x.get("p", {}).get(s, {}).get("id") for x in stats.values() for s in TT_SLOTS} - {None}
    done = 0
    for iid, it in items.items():
        if it.get("status") != "posted":
            continue
        job, st = jobs.get(iid) or {}, stats.get(iid) or {}
        posted = it.get("postedAt") or it.get("postAt") or 0
        gap = every(now - posted) if posted else 12 * HOUR
        if gap is None or now - (st.get("at") or 0) < gap:
            continue
        p, need = dict(st.get("p") or {}), set()
        if meta:
            media = (job.get("ig") or {}).get("media")
            if not media and "instagram.com" in (it.get("postUrl") or ""):
                media = meta.ig_recent().get(_short(it["postUrl"]))
            if media:
                try:
                    p["ig"] = dict(meta.ig(media), at=now, id=media)
                except autopost.GraphError as e:
                    log("stats: Instagram %s: %s" % (it.get("title"), e))
            video = (job.get("fb") or {}).get("video")
            if video:
                try:
                    p["fb"] = dict(meta.fb(video), at=now, id=video)
                except autopost.GraphError as e:
                    log("stats: Facebook %s: %s" % (it.get("title"), e))
            if meta.no_insights and "ig" in p:
                need.add("ig_insights")
        for slot in TT_SLOTS:
            j = job.get(slot) or {}
            if slot not in it.get("platforms", []) or not j.get("at"):
                continue
            known = (p.get(slot) or {}).get("id")
            v = tt.match(slot, j["at"], known)
            if slot in tt.no_scope:
                need.add("tt_list")
            if v and (v.get("id") == known or v.get("id") not in taken):
                taken.add(v.get("id"))
                p[slot] = {"views": _n(v.get("view_count")), "likes": _n(v.get("like_count")), "comments": _n(v.get("comment_count")),
                           "shares": _n(v.get("share_count")), "url": v.get("share_url") or "", "id": v.get("id"), "at": now}
        if not p and not need:
            continue
        tv = sum(x.get("views") or 0 for x in p.values())
        tl = sum(x.get("likes") or 0 for x in p.values())
        h = (st.get("h") or [])[-79:] + [[now, tv, tl]]
        put("stats", iid, {"item": iid, "at": now, "p": p, "h": h, "need": sorted(need)})
        done += 1
        if done >= 25:      # spread a big first run over several passes
            break
    if done:
        log("stats: updated %d posted video%s" % (done, "" if done == 1 else "s"))

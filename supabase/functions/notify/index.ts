// Gearizo server function. Five jobs:
//  1. Push notifications when something happens in the studio (called by the docs_push database trigger),
//     plus scheduled posts (pg_cron calls action "postdue" every minute): publish what was uploaded to
//     Instagram, mark auto-posted videos as posted, and remind marketing about anything left to post by hand.
//  5. Facebook & Instagram connection for auto-posting (actions meta_*, and GET /notify/meta-callback).
//  2. Calendar sync: read each linked Google Calendar (private iCal link) and store only busy times.
//  3. Shoot feed: an iCal feed of a person's shoots that Google Calendar can subscribe to.
import webpush from "npm:web-push@3.6.7";
import ICAL from "npm:ical.js@2.2.1";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// New projects provide SUPABASE_SECRET_KEYS (JSON); older ones SUPABASE_SERVICE_ROLE_KEY.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const k = keys.default || Object.values(keys)[0];
    if (k) return String(k);
  } catch (_) { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());
webpush.setVapidDetails(
  "mailto:" + (Deno.env.get("VAPID_CONTACT") || "admin@example.com"),
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

type Doc = { collection: string; id: string; data: Record<string, any>; updated_by: string | null };
type Role = "content" | "marketing" | "ecomm" | "hr";
type Msg = { body: string; url: string; tag: string; role?: Role; user?: string; users?: string[] };

const mmss = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => { const [, m, day] = d.split("-").map(Number); return day + " " + MONTHS[m - 1]; };
const TZ = "Asia/Kuala_Lumpur";
const PLAT: Record<string, string> = { reel: "Reel", carousel: "Carousel", story: "Story", tiktok: "TikTok", fb: "FB", shop: "Shop" };
const plats = (d: Record<string, any>) => (Array.isArray(d.platforms) ? d.platforms : []).map((p: string) => PLAT[p] || p).join(", ");
const when = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms));

async function nameOf(id?: string | null) {
  if (!id) return "Someone";
  const { data } = await sb.from("docs").select("data").eq("collection", "profiles").eq("id", id).maybeSingle();
  return (data?.data?.name as string) || "Someone";
}
async function itemInfo(id?: string): Promise<{ title: string; team: Role }> {
  if (!id) return { title: "a video", team: "marketing" };
  const { data } = await sb.from("docs").select("data").eq("collection", "items").eq("id", id).maybeSingle();
  const d = data?.data || {};
  return { title: (d.code ? d.code + " " : "") + (d.title || "a video"), team: d.team === "ecomm" ? "ecomm" : "marketing" };
}

/* ---------- 1. what to tell whom ---------- */
async function describe(type: string, rec: Doc, old: Doc | null, roleOf: Record<string, string>): Promise<Msg | null> {
  const d = rec.data || {}, o = old?.data || {};
  const actor = rec.updated_by;
  switch (rec.collection) {
    case "tasks":
      if (type === "INSERT" && !d.done)
        return { role: (["content", "marketing", "ecomm", "hr"].includes(d.for) ? d.for : "content") as Role, body: `${await nameOf(d.by || actor)} gave you a task: ${d.text}` + (d.due ? ` (due ${shortDate(d.due)})` : ""), url: "./#tasks", tag: "task-" + rec.id };
      if (type === "UPDATE" && d.done && !o.done && d.by)
        return { user: d.by, body: `${await nameOf(d.doneBy || actor)} finished: ${d.text}`, url: "./#tasks", tag: "task-" + rec.id };
      return null;
    case "feedback":
      if (type !== "INSERT") return null;
      return { role: "content", body: `${await nameOf(d.by || actor)} left feedback on ${(await itemInfo(d.item)).title}` + (d.version ? ` v${d.version}` : "") + (d.img ? ` (image ${d.img})` : typeof d.t === "number" ? ` at ${mmss(d.t)}` : "") + (d.text ? `: ${d.text}` : ""), url: "./#review", tag: "fb-" + d.item };
    case "versions":
      if (type !== "INSERT") return null;
      { const info = await itemInfo(d.item);
        return { role: info.team, body: `${await nameOf(d.by || actor)} added v${d.n} of ${info.title}`, url: "./#review", tag: "item-" + d.item }; }
    case "inbox":
      if (type !== "INSERT") return null;
      return { role: "content", body: `New video in Checking: ${d.name}. Pick its content.`, url: "./#review", tag: "inbox" };
    case "shoots": {
      const talent: string[] = Array.isArray(d.talent) ? d.talent : [];
      const what = d.title ? ` · ${d.title}` : "";
      if (type === "INSERT" && d.status === "proposed")
        return { users: talent, body: `${await nameOf(d.by || actor)} wants to book you for a shoot: ${when(d.start)}${what}${d.location ? " · " + d.location : ""}. Tap to confirm.`, url: "./#shoots", tag: "shoot-" + rec.id };
      if (type !== "UPDATE") return null;
      if (d.status !== o.status) {
        if (d.status === "confirmed") return { role: "content", body: `${await nameOf(actor)} confirmed the shoot on ${when(d.start)}${what}`, url: "./#shoots", tag: "shoot-" + rec.id };
        if (d.status === "declined") return { role: "content", body: `${await nameOf(actor)} can't make the shoot on ${when(d.start)}${what}` + (d.reply ? `: ${d.reply}` : ""), url: "./#shoots", tag: "shoot-" + rec.id };
        if (d.status === "cancelled") return { users: talent, body: `The shoot on ${when(d.start)}${what} was cancelled`, url: "./#shoots", tag: "shoot-" + rec.id };
        if (d.status === "proposed") return { users: talent, body: `New time for a shoot: ${when(d.start)}${what}. Tap to confirm.`, url: "./#shoots", tag: "shoot-" + rec.id };
      }
      return null;
    }
    case "items": {
      const title = (d.code ? d.code + " " : "") + (d.title || "a video");
      const itemTeam: Role = d.team === "ecomm" ? "ecomm" : "marketing";
      if (type === "INSERT" && d.createdBy) {
        const mk = ["marketing", "ecomm"].includes(roleOf[d.createdBy]);
        return { role: mk ? "content" : itemTeam, body: `${await nameOf(d.createdBy)} ${mk ? "assigned" : "planned"} ${title}` + (d.date ? ` for ${shortDate(d.date)}` : ""), url: "./#calendar", tag: "item-" + rec.id };
      }
      if (type !== "UPDATE") return null;
      if (d.status === "scheduled" && Number(d.postAt) > 0 && (o.status !== "scheduled" || Number(d.postAt) !== Number(o.postAt))) {
        const moved = o.status === "scheduled";
        return { role: "content", body: `${await nameOf(d.scheduledBy || actor)} ${moved ? "moved" : "scheduled"} ${title} ${moved ? "to" : "for"} ${when(Number(d.postAt))}` + (plats(d) ? ` · ${plats(d)}` : ""), url: "./#review/" + rec.id, tag: "item-" + rec.id };
      }
      if (d.status === o.status) return null;
      if (d.status === "review") return { role: itemTeam, body: `${await nameOf(d.submittedBy || actor)} sent ${title}` + (d.submittedV ? ` v${d.submittedV}` : "") + " for review", url: "./#review", tag: "item-" + rec.id };
      if (d.status === "changes") return { role: "content", body: `${await nameOf(d.changesBy || actor)} asked for changes on ${title}`, url: "./#review", tag: "item-" + rec.id };
      if (d.status === "approved") return { role: "content", body: `${await nameOf(d.approvedBy || actor)} approved ${title}`, url: "./#review", tag: "item-" + rec.id };
      if (d.status === "posted" && d.postedBy === "auto") return { body: `Posted ${title} automatically` + (plats(d) ? ` on ${plats(d)}` : ""), url: "./#review/" + rec.id, tag: "item-" + rec.id };
      if (d.status === "posted") return { role: "content", body: `${await nameOf(d.postedBy || actor)} posted ${title}` + (plats(d) ? ` on ${plats(d)}` : ""), url: "./#review/" + rec.id, tag: "item-" + rec.id };
      return null;
    }
  }
  return null;
}

async function roles(): Promise<Record<string, string>> {
  const { data: team } = await sb.rpc("team_roles");
  return Object.fromEntries((team || []).map((r: any) => [r.user_id, r.role]));
}
async function notify(type: string, record: Doc, old_record: Doc | null) {
  const roleOf = await roles();
  const msg = await describe(type, record, old_record, roleOf);
  if (!msg) return { sent: 0, note: "nothing to send" };
  return send(msg, record.updated_by, roleOf);
}
async function send(msg: Msg, actor: string | null, roleOf: Record<string, string>) {
  const { data: subs } = await sb.from("push_subs").select("endpoint,user_id,sub");
  const targets = (subs || []).filter((s: any) =>
    s.user_id !== actor &&
    (msg.users ? msg.users.includes(s.user_id) : msg.user ? s.user_id === msg.user : !msg.role || roleOf[s.user_id] === msg.role));
  const payload = JSON.stringify({ title: "Gearizo", body: msg.body.slice(0, 240), url: msg.url, tag: msg.tag });
  let sent = 0;
  await Promise.all(targets.map(async (s: any) => {
    try { await webpush.sendNotification(s.sub, payload, { TTL: 86400, urgency: "high" }); sent++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
  }));
  return { sent };
}

/* ---------- Meta (Facebook + Instagram) ---------- */
const GRAPH = "https://graph.facebook.com/v27.0";
const AUTO = ["reel", "fb"];                                   // posted automatically when connected
const CALLBACK = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/notify/meta-callback";
const SCOPES = "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management";
class GraphError extends Error { code?: number }
async function graph(path: string, params: Record<string, string>, token: string, method = "GET") {
  const q = new URLSearchParams(token ? { ...params, access_token: token } : params);
  const r = method === "GET" ? await fetch(GRAPH + path + "?" + q, { signal: AbortSignal.timeout(30000) })
    : await fetch(GRAPH + path, { method, body: q, signal: AbortSignal.timeout(30000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) { const e = new GraphError(j.error?.error_user_msg || j.error?.message || ("Meta answered " + r.status)); e.code = j.error?.code; throw e; }
  return j;
}
async function metaRow(): Promise<any> {
  const { data } = await sb.from("social_meta").select("*").eq("id", 1).maybeSingle();
  return data || null;
}
const metaSet = (patch: Record<string, unknown>) => sb.from("social_meta").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() });
/* Instagram calls: try the Page token first, then the user token */
async function ig(path: string, params: Record<string, string>, m: any, method = "GET") {
  try { return await graph(path, params, m.page_token, method); }
  catch (e) { if (m.user_token && m.user_token !== m.page_token) return await graph(path, params, m.user_token, method); throw e; }
}
const errText = (e: unknown) => String((e as any)?.message || e).slice(0, 300);

async function metaStatus() {
  const m = await metaRow();
  return { connected: !!(m?.page_token && (m?.ig_id || m?.page_id)), hasApp: !!(m?.app_id && m?.app_secret), page: m?.page_name || "", ig: m?.ig_username || "",
    connectedAt: m?.connected_at || null, expires: m?.user_token_expires || null, error: m?.last_error || "", callback: CALLBACK };
}
async function metaStart(body: any, me: string) {
  const patch: Record<string, unknown> = {};
  if (body.app_id) patch.app_id = String(body.app_id).trim().slice(0, 40);
  if (body.app_secret) patch.app_secret = String(body.app_secret).trim().slice(0, 80);
  const ret = String(body.return_url || "");
  if (!/^https:\/\/[a-z0-9.-]+\.github\.io\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(ret)) return { error: "bad return address" };
  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await metaSet({ ...patch, oauth_state: state, oauth_user: me, oauth_return: ret, oauth_at: new Date().toISOString() });
  const m = await metaRow();
  if (!m?.app_id || !m?.app_secret) return { error: "Add the App ID and App Secret first." };
  const q = new URLSearchParams({ client_id: m.app_id, redirect_uri: CALLBACK, state, response_type: "code", scope: SCOPES,
    extras: JSON.stringify({ setup: { channel: "IG_API_ONBOARDING" } }) });
  return { url: "https://www.facebook.com/v27.0/dialog/oauth?" + q };
}
async function metaCallback(url: URL) {
  const m = await metaRow();
  const back = (ok: boolean, why = "") => Response.redirect((m?.oauth_return || "https://wanyuuuuuu.github.io/gearizo-studio/") + "?meta=" + (ok ? "ok" : "err") + (why ? "&why=" + encodeURIComponent(why.slice(0, 160)) : "") + "#home", 302);
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  if (!m || !m.oauth_state || state !== m.oauth_state || Date.now() - Date.parse(m.oauth_at || "0") > 20 * 60000) return back(false, "The sign-in link expired. Press Connect again.");
  await metaSet({ oauth_state: null });
  if (!code) return back(false, url.searchParams.get("error_description") || "Facebook sign-in was cancelled.");
  try {
    const short = await graph("/oauth/access_token", { client_id: m.app_id, client_secret: m.app_secret, redirect_uri: CALLBACK, code }, "");
    const long = await graph("/oauth/access_token", { grant_type: "fb_exchange_token", client_id: m.app_id, client_secret: m.app_secret, fb_exchange_token: short.access_token }, "");
    const pages = await graph("/me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50" }, long.access_token);
    const list: any[] = pages.data || [];
    const page = list.find((p) => p.instagram_business_account) || list[0];
    if (!page) return back(false, "No Facebook Page came back. Tick the Gearizo Page when Facebook asks.");
    await metaSet({ page_id: page.id, page_name: page.name, page_token: page.access_token, ig_id: page.instagram_business_account?.id || null,
      ig_username: page.instagram_business_account?.username || null, user_token: long.access_token,
      user_token_expires: long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null,
      connected_by: m.oauth_user, connected_at: new Date().toISOString(), last_error: page.instagram_business_account ? null : "This Page has no Instagram business account linked." });
    return back(true);
  } catch (e) { await metaSet({ last_error: errText(e) }); return back(false, errText(e)); }
}
async function metaCheck() {
  const m = await metaRow();
  if (!m?.page_token) return { ok: false, error: "Not connected" };
  try {
    const page = await graph("/" + m.page_id, { fields: "name" }, m.page_token);
    let igName = "";
    if (m.ig_id) igName = (await ig("/" + m.ig_id, { fields: "username" }, m)).username || "";
    await metaSet({ page_name: page.name, ig_username: igName || m.ig_username, last_error: m.ig_id ? null : "This Page has no Instagram business account linked." });
    return { ok: true, page: page.name, ig: igName };
  } catch (e) { await metaSet({ last_error: errText(e) }); return { ok: false, error: errText(e) }; }
}
async function metaDisconnect() {
  await metaSet({ page_id: null, page_name: null, page_token: null, user_token: null, user_token_expires: null, ig_id: null, ig_username: null, connected_at: null, last_error: null });
  return { ok: true };
}

/* Scheduled posts that are due: publish what was uploaded, then remind about anything left, once */
async function postDue() {
  const now = Date.now();
  const { data: rows } = await sb.from("docs").select("id,data").eq("collection", "items").eq("data->>status", "scheduled");
  const due = (rows || []).filter((r: any) => Number(r.data?.postAt) > 0 && Number(r.data.postAt) <= now + 60000);
  if (!due.length) return { due: 0 };
  const m = await metaRow(), linked = !!m?.page_token;
  const roleOf = await roles();
  let sent = 0;
  const out: any[] = [];
  for (const r of due) {
    const d = r.data || {};
    const pl: string[] = Array.isArray(d.platforms) ? d.platforms : [];
    const { data: jr } = await sb.from("docs").select("data").eq("collection", "postjobs").eq("id", r.id).maybeSingle();
    const job: any = jr?.data || { item: r.id };
    let changed = false;
    if (linked && pl.includes("reel") && job.ig?.state === "uploaded" && m.ig_id) {
      try {
        const st = (await ig("/" + job.ig.container, { fields: "status_code" }, m)).status_code;
        if (st === "FINISHED") {
          const pub = await ig("/" + m.ig_id + "/media_publish", { creation_id: job.ig.container }, m, "POST");
          let link = ""; try { link = (await ig("/" + pub.id, { fields: "permalink" }, m)).permalink || ""; } catch (_) { /* link is optional */ }
          job.ig = { ...job.ig, state: "posted", media: pub.id, permalink: link, at: now }; changed = true;
        } else if (st === "ERROR" || st === "EXPIRED" || now - Number(d.postAt) > 30 * 60000) {
          job.ig = { ...job.ig, state: "failed", error: st === "IN_PROGRESS" ? "Instagram was still processing the video" : "Instagram couldn't use the video (" + st + ")", at: now }; changed = true;
        }
      } catch (e) { job.ig = { ...job.ig, state: "failed", error: errText(e), at: now }; changed = true; }
    }
    if (linked && pl.includes("fb") && job.fb?.state === "scheduled") {
      let link = "";
      try { const v = await graph("/" + job.fb.video, { fields: "permalink_url" }, m.page_token); link = v.permalink_url ? (String(v.permalink_url).startsWith("http") ? v.permalink_url : "https://www.facebook.com" + v.permalink_url) : ""; } catch (_) { /* optional */ }
      job.fb = { ...job.fb, state: "posted", permalink: link, at: now }; changed = true;
    }
    if (changed) await sb.from("docs").upsert({ collection: "postjobs", id: r.id, data: job });
    if (job.ig?.state === "uploaded") continue;                  // Instagram still processing: try again next minute
    const done = (p: string) => (p === "reel" && job.ig?.state === "posted") || (p === "fb" && job.fb?.state === "posted");
    const left = pl.filter((p) => !done(p));
    if (pl.length && !left.length) {
      const link = job.ig?.permalink || job.fb?.permalink || "";
      await sb.from("docs").update({ data: { ...d, status: "posted", postedAt: now, postedBy: "auto", postUrl: d.postUrl || link, remindedAt: now } }).eq("collection", "items").eq("id", r.id);
      out.push({ id: r.id, posted: true });
      continue;
    }
    if (Number(d.remindedAt)) continue;
    await sb.from("docs").update({ data: { ...d, remindedAt: now } }).eq("collection", "items").eq("id", r.id);
    const fails: string[] = [];
    if (job.ig?.state === "failed") fails.push("Instagram: " + job.ig.error);
    if (job.fb?.state === "failed") fails.push("Facebook: " + job.fb.error);
    if (linked && !fails.length && left.some((p) => AUTO.includes(p))) fails.push("the video wasn't uploaded in time (is the Mac on and the NAS connected?)");
    const auto = pl.filter(done).map((p) => PLAT[p] || p);
    const title = (d.code ? d.code + " " : "") + (d.title || "a video");
    const body = `Time to post ${title} on ${left.map((p) => PLAT[p] || p).join(", ")}` + (auto.length ? ` (${auto.join(", ")} went out automatically)` : "") +
      (fails.length ? `. Auto-post didn't work: ${fails.join("; ")}` : ". The caption is ready in the app.");
    sent += (await send({ role: d.team === "ecomm" ? "ecomm" : "marketing", body, url: "./#review/" + r.id, tag: "post-" + r.id }, null, roleOf)).sent;
  }
  return { due: due.length, sent, out };
}

/* ---------- 2. Google Calendar → busy times (only start and end are kept) ---------- */
function busyFromIcs(text: string, fromMs: number, toMs: number, tzOffsetMinutes = 480): number[][] {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
  const overrides: Record<string, any[]> = {}, masters: any[] = [];
  for (const v of comp.getAllSubcomponents("vevent")) {
    if (v.hasProperty("recurrence-id")) (overrides[v.getFirstPropertyValue("uid")] ||= []).push(v);
    else masters.push(v);
  }
  const ms = (t: any) => t.isDate ? Date.UTC(t.year, t.month - 1, t.day) - tzOffsetMinutes * 60000 : t.toJSDate().getTime();
  const out: number[][] = [];
  const add = (s: number, e: number, transp: string, status: string) => {
    if (status === "CANCELLED" || transp === "TRANSPARENT") return;
    if (!(e > s) || e <= fromMs || s >= toMs) return;
    out.push([Math.max(s, fromMs), Math.min(e, toMs)]);
  };
  for (const v of masters) {
    const ev = new ICAL.Event(v, { exceptions: overrides[v.getFirstPropertyValue("uid")] || [] });
    const transp = String(v.getFirstPropertyValue("transp") || "OPAQUE").toUpperCase();
    const status = String(v.getFirstPropertyValue("status") || "").toUpperCase();
    if (!ev.isRecurring()) { add(ms(ev.startDate), ms(ev.endDate || ev.startDate), transp, status); continue; }
    const it = ev.iterator();
    for (let next: any, n = 0; (next = it.next()) && n < 50000; n++) {
      if (ms(next) >= toMs) break;
      const det = ev.getOccurrenceDetails(next), c = det.item.component;
      add(ms(det.startDate), ms(det.endDate),
        String(c.getFirstPropertyValue("transp") || transp).toUpperCase(),
        String(c.getFirstPropertyValue("status") || status).toUpperCase());
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [s, e] of out) { const last = merged[merged.length - 1]; if (last && s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e]); }
  return merged;
}

async function calsync(onlyUser?: string) {
  let q = sb.from("calendar_links").select("user_id,ics_url");
  if (onlyUser) q = q.eq("user_id", onlyUser);
  const { data: links } = await q;
  const from = Date.now() - 86400000, to = Date.now() + 45 * 86400000;
  const results: any[] = [];
  for (const l of links || []) {
    const uid = l.user_id as string;
    try {
      let blocks: number[][] = [];
      if (l.ics_url) {
        const url = String(l.ics_url).replace(/^webcal:\/\//i, "https://");
        if (!/^https:\/\//i.test(url)) throw new Error("The link must start with https://");
        const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Gearizo calendar sync" } });
        if (!r.ok) throw new Error(`Google answered ${r.status}. Check the link is the "secret address in iCal format".`);
        const text = await r.text();
        if (text.length > 8_000_000) throw new Error("That calendar is too big to read.");
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link isn't an iCal calendar.");
        blocks = busyFromIcs(text, from, to);
      }
      await sb.from("docs").delete().eq("collection", "busy").eq("data->>user", uid);
      if (blocks.length) await sb.from("docs").insert(blocks.slice(0, 2000).map(([s, e], i) => ({ collection: "busy", id: `${uid}-${i}`, data: { user: uid, start: s, end: e } })));
      await sb.from("calendar_links").update({ last_sync: new Date().toISOString(), last_error: null }).eq("user_id", uid);
      results.push({ user: uid.slice(0, 8), busy: blocks.length });
    } catch (e: any) {
      await sb.from("calendar_links").update({ last_sync: new Date().toISOString(), last_error: String(e?.message || e).slice(0, 300) }).eq("user_id", uid);
      results.push({ user: uid.slice(0, 8), error: String(e?.message || e) });
    }
  }
  return results;
}

/* ---------- 3. a person's shoots as an iCal feed for Google Calendar ---------- */
const icsTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
async function feed(token: string) {
  const { data: link } = await sb.from("calendar_links").select("user_id").eq("feed_token", token).maybeSingle();
  if (!link) return new Response("not found", { status: 404 });
  const { data: rows } = await sb.from("docs").select("id,data").eq("collection", "shoots").contains("data", { talent: [link.user_id] });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gearizo//Shoots//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Gearizo shoots", "X-PUBLISHED-TTL:PT1H"];
  for (const r of rows || []) {
    const d = r.data || {};
    if (!["proposed", "confirmed"].includes(d.status) || !d.start || !d.end) continue;
    lines.push("BEGIN:VEVENT", `UID:${r.id}@gearizo`, `DTSTAMP:${icsTime(Date.now())}`, `DTSTART:${icsTime(d.start)}`, `DTEND:${icsTime(d.end)}`,
      `SUMMARY:${icsText((d.status === "proposed" ? "(to confirm) " : "") + "Gearizo shoot" + (d.title ? ": " + d.title : ""))}`,
      ...(d.location ? [`LOCATION:${icsText(d.location)}`] : []), ...(d.notes ? [`DESCRIPTION:${icsText(d.notes)}`] : []),
      `STATUS:${d.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "max-age=900" } });
}

/* ---------- who is calling ---------- */
async function caller(req: Request): Promise<{ id: string; role: string; owner: boolean } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) return null;
  const { data } = await sb.auth.getUser(token);
  const u = data?.user; if (!u?.email) return null;
  const { data: m } = await sb.from("members").select("role,is_owner").ilike("email", u.email).maybeSingle();
  return m ? { id: u.id, role: m.role, owner: !!m.is_owner } : null;
}
async function callerId(req: Request): Promise<string | null> { return (await caller(req))?.id || null; }
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("feed")) return feed(url.searchParams.get("feed")!);
  if (req.method === "GET" && url.pathname.endsWith("/meta-callback")) return metaCallback(url);
  const fromDb = req.headers.get("x-gz-secret") === Deno.env.get("GZ_HOOK_SECRET");
  const body = await req.json().catch(() => ({}));
  if (body.action === "calsync") {
    if (fromDb) return json({ synced: await calsync() });
    const me = await callerId(req);                       // a signed-in team member syncing their own calendar
    if (!me) return json({ error: "sign in first" }, 401);
    return json({ synced: await calsync(me) });
  }
  if (String(body.action || "").startsWith("meta_")) {
    const me = await caller(req);
    if (!me) return json({ error: "sign in first" }, 401);
    if (body.action === "meta_status") return json(await metaStatus());
    if (body.action === "meta_check") return json(await metaCheck());
    if (!(me.owner || ["marketing", "ecomm"].includes(me.role))) return json({ error: "Only marketing or the studio owner can change this." }, 403);
    if (body.action === "meta_start") return json(await metaStart(body, me.id));
    if (body.action === "meta_disconnect") return json(await metaDisconnect());
    return json({ error: "unknown action" }, 400);
  }
  if (!fromDb) return json({ error: "forbidden" }, 401);
  if (body.action === "postdue") return json(await postDue());
  return json(await notify(body.type, body.record, body.old_record));
});

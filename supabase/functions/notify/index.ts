// Gearizo server function. Four jobs:
//  1. Push notifications when something happens in the studio (called by the docs_push database trigger),
//     plus a "time to post" reminder for scheduled posts (pg_cron calls action "postdue" every minute).
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

/* Scheduled posts that are due: remind the team that posts them, once */
async function postDue() {
  const now = Date.now();
  const { data: rows } = await sb.from("docs").select("id,data").eq("collection", "items").eq("data->>status", "scheduled");
  const due = (rows || []).filter((r: any) => Number(r.data?.postAt) > 0 && Number(r.data.postAt) <= now + 60000 && !Number(r.data.remindedAt));
  if (!due.length) return { due: 0 };
  const roleOf = await roles();
  let sent = 0;
  for (const r of due) {
    const d = r.data || {};
    await sb.from("docs").update({ data: { ...d, remindedAt: now } }).eq("collection", "items").eq("id", r.id);
    const title = (d.code ? d.code + " " : "") + (d.title || "a video");
    const res = await send({ role: d.team === "ecomm" ? "ecomm" : "marketing", body: `Time to post ${title}` + (plats(d) ? ` on ${plats(d)}` : "") + ". The caption is ready in the app.", url: "./#review/" + r.id, tag: "post-" + r.id }, null, roleOf);
    sent += res.sent;
  }
  return { due: due.length, sent };
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
async function callerId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) return null;
  const { data } = await sb.auth.getUser(token);
  const u = data?.user; if (!u?.email) return null;
  const { data: m } = await sb.from("members").select("role").ilike("email", u.email).maybeSingle();
  return m ? u.id : null;
}
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("feed")) return feed(url.searchParams.get("feed")!);
  const fromDb = req.headers.get("x-gz-secret") === Deno.env.get("GZ_HOOK_SECRET");
  const body = await req.json().catch(() => ({}));
  if (body.action === "calsync") {
    if (fromDb) return json({ synced: await calsync() });
    const me = await callerId(req);                       // a signed-in team member syncing their own calendar
    if (!me) return json({ error: "sign in first" }, 401);
    return json({ synced: await calsync(me) });
  }
  if (!fromDb) return json({ error: "forbidden" }, 401);
  if (body.action === "postdue") return json(await postDue());
  return json(await notify(body.type, body.record, body.old_record));
});
